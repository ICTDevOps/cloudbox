// Outils proposés au modèle, et accès aux terminaux du workspace.
//
// Lecture libre (sans validation), toujours limitée au workspace et masquée :
//   get_context, read_terminal, list_files, read_file, remember
// Action : run_command crée seulement une proposition. La commande n'est tapée et lancée dans un
// terminal qu'après validation explicite de l'utilisateur dans le portail (runApproved).

import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  HOME, HttpError, cloudContext as readCloudContext, identityMode, run, sessionIdentity, sessionPattern, workspaceSessions, type Workspace,
} from '../lib.ts';
import type { ToolSpec } from './providers.ts';
import { redactText } from './redact.ts';
import { MAX_MEMORY, readMemory, writeMemory } from './store.ts';

const MAX_TOOL_OUTPUT = 16 * 1024;
const MAX_FILE = 64 * 1024;
const MAX_LIST = 200;
const MAX_TERMINAL_LINES = 500;
const RUN_TIMEOUT_MS = 120_000;
// Repli sans signal du prompt (prompt personnalisé) : sortie inchangée pendant ce délai
const RUN_STABLE_MS = 3000;
const RUN_POLL_MS = 500;

export const TOOLS: ToolSpec[] = [
  {
    name: 'get_context',
    description:
      "Contexte réel du moment : abonnement Azure CLI et Az PowerShell (nom, id, tenant, compte), contexte kubectl. " +
      'À relire avant une commande qui dépend de l\'abonnement ou du cluster.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'read_terminal',
    description:
      "Lit les dernières lignes affichées dans un terminal du workspace (secrets masqués). Sans « session », " +
      "lit le terminal actif de l'utilisateur.",
    parameters: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session tmux du workspace (liste dans les instructions)' },
        lines: { type: 'integer', minimum: 10, maximum: MAX_TERMINAL_LINES, description: 'Nombre de lignes (défaut 100)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_files',
    description: 'Liste un dossier du workspace (chemin relatif au dossier du workspace, « . » par défaut).',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'read_file',
    description: `Lit un fichier texte du workspace (chemin relatif, ${MAX_FILE / 1024} Ko max., secrets masqués).`,
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
  },
  {
    name: 'run_command',
    description:
      "Propose une commande à exécuter dans un terminal du workspace. L'utilisateur la voit, peut la modifier, " +
      "puis la valide ou la refuse ; si elle est validée, elle est lancée dans son terminal actif et tu reçois la " +
      'sortie. Une seule ligne, non interactive (pas de confirmation à saisir, pas de pager). ' +
      'Les connexions PowerShell (Connect-MgGraph, Connect-ExchangeOnline…) sont celles du terminal visé : ' +
      'voir « terminals » dans le contexte réel.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Commande, sur une seule ligne' },
        shell: { type: 'string', enum: ['pwsh', 'bash'], description: 'Shell visé' },
        reason: { type: 'string', description: "Pourquoi cette commande, en une phrase, dans la langue de l'utilisateur" },
      },
      required: ['command', 'shell', 'reason'],
      additionalProperties: false,
    },
  },
  {
    name: 'remember',
    description:
      'Ajoute une note durable à la mémoire de ce workspace (préférences, faits stables sur le client). ' +
      'Jamais de secret, jamais de donnée personnelle sensible.',
    parameters: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'], additionalProperties: false },
  },
];

export interface ToolContext {
  ws: Workspace;
  // Terminal actif de l'utilisateur (dernier utilisé dans le portail), s'il y en a un
  activeSession: string | null;
}

function cap(text: string, max = MAX_TOOL_OUTPUT): string {
  return text.length > max ? `[… ${text.length - max} caractères tronqués au début …]\n${text.slice(-max)}` : text;
}

// Contexte réel des terminaux du workspace (connexions isolées ou partagées, sessions ouvertes dans
// chaque terminal PowerShell, CLI for Microsoft 365), sans GitHub
export async function cloudContext(ws: Workspace) {
  const { azureCli, azPowerShell, kubernetes, m365, terminals, identities, shared, sharedAcrossWorkspaces } = await readCloudContext(ws);
  return { azureCli, azPowerShell, kubernetes, m365, terminals, identities, shared, sharedAcrossWorkspaces };
}

// --- Terminaux ---

export async function checkWorkspaceSession(ws: Workspace, session: unknown): Promise<string> {
  if (typeof session !== 'string' || !sessionPattern(ws.id).test(session)) {
    throw new HttpError(400, 'Session invalide (terminal de ce workspace attendu)', 'Invalid session (a terminal of this workspace is expected)');
  }
  if (!(await workspaceSessions(ws.id)).includes(session)) {
    throw new HttpError(404, 'Session introuvable (terminal fermé ?)', 'Session not found (terminal closed?)');
  }
  return session;
}

// Terminal dont les connexions ne sont pas celles du workspace (ouvert avant l'isolation ou avant un
// changement de mode) : le contexte affiché sur la carte ne serait pas celui de la commande
export async function checkSessionIdentity(ws: Workspace, session: string): Promise<void> {
  if ((await sessionIdentity(session)) !== identityMode(ws)) {
    throw new HttpError(409, 'Ce terminal a été ouvert avec d\'autres connexions que celles du workspace : fermez-le puis rouvrez-le',
      'This terminal was opened with other sign-ins than the workspace ones: close it and open it again');
  }
}

function trimBlank(text: string): string {
  return text.replace(/\s+$/, '');
}

interface PaneState {
  history: number;
  cursor: number;
  cursorX: number;
  command: string;
  // Signal des prompts Cloudbox : « <n>:<code de sortie> », incrémenté à chaque prompt (vide si le
  // prompt a été remplacé par l'utilisateur)
  prompt: string;
}

async function pane(session: string): Promise<PaneState> {
  const out = await run('tmux', ['display-message', '-p', '-t', `=${session}:`,
    '#{history_size}\t#{cursor_y}\t#{cursor_x}\t#{pane_current_command}\t#{@cloudbox_prompt}']);
  const [history, cursor, cursorX, command, prompt] = out.replace(/\n$/, '').split('\t');
  return {
    history: Number(history) || 0,
    cursor: Number(cursor) || 0,
    cursorX: Number(cursorX) || 0,
    command: command ?? '',
    prompt: prompt ?? '',
  };
}

async function capture(session: string, start: number | string): Promise<string> {
  return run('tmux', ['capture-pane', '-p', '-J', '-t', `=${session}:`, '-S', String(start), '-E', '-'], 5000);
}

export async function readTerminal(session: string, lines = 100): Promise<string> {
  const n = Math.min(MAX_TERMINAL_LINES, Math.max(10, Math.floor(lines)));
  const { cursor } = await pane(session);
  // -S : lignes comptées depuis le haut de l'écran visible, négatives dans l'historique
  const text = await capture(session, cursor - n + 1);
  return cap(redactText(trimBlank(text)));
}

// Le shell est au premier plan (pas d'éditeur, de pager ni de commande externe lancée par bash).
// pwsh ne change pas le groupe de processus au premier plan : pour lui, ce test ne voit que pwsh.
const SHELL_COMMANDS: Record<string, string[]> = { pwsh: ['pwsh'], bash: ['bash'] };

// Dernière ligne des prompts Cloudbox (bashrc, profile.ps1)
const PROMPT_MARKS: Record<string, string> = { pwsh: 'PS>', bash: '$' };

// Terminal prêt à recevoir une commande : shell au premier plan et, avec les prompts Cloudbox
// (signal @cloudbox_prompt présent), curseur sur une ligne de prompt vide. Refuse donc un texte
// déjà saisi (panneau Connexions, frappe en cours) qui serait exécuté avec la commande, et une
// commande pwsh en attente de réponse (Read-Host, confirmation, device code), invisible sinon.
async function terminalReady(session: string, shell: 'pwsh' | 'bash', state?: PaneState): Promise<boolean> {
  const p = state ?? (await pane(session));
  if (!SHELL_COMMANDS[shell].includes(p.command)) {
    console.error(`[cloudbox-api] terminal non prêt ${session} : commande au premier plan ${p.command}`);
    return false;
  }
  if (!p.prompt) return true; // prompt personnalisé : seul le test du premier plan est possible
  const line = await run('tmux', ['capture-pane', '-p', '-t', `=${session}:`, '-S', String(p.cursor), '-E', String(p.cursor)])
    .catch(() => '');
  const mark = PROMPT_MARKS[shell];
  const text = line.replace(/\s+$/, '');
  const ready = text.endsWith(mark) && p.cursorX === text.length + 1;
  if (!ready) {
    console.error(`[cloudbox-api] terminal non prêt ${session} : commande=${p.command} curseur=${p.cursorX} ligne=${JSON.stringify(redactText(text).slice(-80))}`);
  }
  return ready;
}

export async function terminalIdle(session: string, shell: 'pwsh' | 'bash'): Promise<boolean> {
  return terminalReady(session, shell);
}

export function busyError(): HttpError {
  return new HttpError(409,
    'Terminal occupé ou ligne déjà saisie : attendez la fin de la commande, ou videz la ligne (Échap dans PowerShell, Ctrl+U dans Bash)',
    'Terminal busy or line not empty: wait for the command to finish, or clear the line (Esc in PowerShell, Ctrl+U in Bash)');
}

export interface RunResult {
  output: string;
  finished: boolean;
  // Code de sortie signalé par le prompt (pwsh : 0 succès, 1 échec), null s'il est inconnu
  exitCode: number | null;
}

// Commande validée par l'utilisateur : saisie littérale, puis Entrée (envoyée à part, seul chemin de
// l'API qui envoie Entrée). Fin de la commande : le prompt suivant (signal @cloudbox_prompt des
// prompts Cloudbox) ; à défaut, sortie stable et shell revenu au premier plan. Au plus RUN_TIMEOUT_MS.
export async function runApproved(session: string, shell: 'pwsh' | 'bash', command: string, signal: AbortSignal): Promise<RunResult> {
  const before = await pane(session);
  if (!(await terminalReady(session, shell, before))) throw busyError();
  const startAbs = before.history + before.cursor;
  const promptSignal = before.prompt !== '';
  await run('tmux', ['send-keys', '-t', `=${session}:`, '-l', '--', command]);
  await run('tmux', ['send-keys', '-t', `=${session}:`, 'Enter']);

  const deadline = Date.now() + RUN_TIMEOUT_MS;
  let last = '';
  let stableSince = Date.now();
  let finished = false;
  let exitCode: number | null = null;
  while (Date.now() < deadline && !signal.aborted) {
    await new Promise((resolve) => setTimeout(resolve, RUN_POLL_MS));
    const now = await pane(session).catch(() => null);
    if (!now) break; // session fermée
    // Ligne de la commande, relative au haut de l'écran (négative si elle est passée dans l'historique)
    const text = await capture(session, Math.max(-now.history, startAbs - now.history)).catch(() => last);
    if (text !== last) {
      last = text;
      stableSince = Date.now();
    }
    if (promptSignal) {
      if (now.prompt !== before.prompt) {
        finished = true;
        const code = Number(now.prompt.split(':')[1]);
        exitCode = Number.isInteger(code) ? code : null;
        // Dernier affichage (le prompt est écrit juste après le signal)
        await new Promise((resolve) => setTimeout(resolve, 150));
        last = await capture(session, Math.max(-now.history, startAbs - now.history)).catch(() => last);
        break;
      }
    } else if (Date.now() - stableSince >= RUN_STABLE_MS && SHELL_COMMANDS[shell].includes(now.command)) {
      finished = true;
      break;
    }
  }
  return { output: cap(redactText(trimBlank(last))), finished, exitCode };
}

// --- Fichiers du workspace ---

async function workspacePath(ws: Workspace, rel: unknown): Promise<string> {
  const raw = typeof rel === 'string' && rel.trim() ? rel.trim() : '.';
  const abs = path.resolve(ws.folder, raw);
  const root = await realpath(ws.folder);
  const real = await realpath(abs).catch(() => {
    throw new Error(`introuvable : ${raw}`);
  });
  if (real !== root && !real.startsWith(root + '/')) throw new Error('chemin hors du dossier du workspace');
  // Dossiers cachés du home (jeton Cloudbox, ~/.azure, ~/.kube, ~/.ssh, config de l'assistant…) :
  // jamais lus, même si le dossier du workspace est /home/dev
  const fromHome = path.relative(HOME, real);
  if (!fromHome.startsWith('..') && fromHome.split(path.sep)[0].startsWith('.')) {
    throw new Error('fichier de configuration du home : non lisible par l\'assistant');
  }
  return real;
}

// --- Exécution des outils sans validation ---

export async function runReadTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  try {
    switch (name) {
      case 'get_context':
        return JSON.stringify(await cloudContext(ctx.ws), null, 2);

      case 'read_terminal': {
        const session = args.session === undefined ? ctx.activeSession : args.session;
        if (!session) return 'Aucun terminal ouvert dans ce workspace.';
        const checked = await checkWorkspaceSession(ctx.ws, session);
        const text = await readTerminal(checked, typeof args.lines === 'number' ? args.lines : 100);
        return text || '(terminal vide)';
      }

      case 'list_files': {
        const dir = await workspacePath(ctx.ws, args.path);
        const entries = await readdir(dir, { withFileTypes: true });
        const names = entries
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .sort((a, b) => a.localeCompare(b));
        const more = names.length > MAX_LIST ? `\n… ${names.length - MAX_LIST} autres` : '';
        return names.slice(0, MAX_LIST).join('\n') + more || '(dossier vide)';
      }

      case 'read_file': {
        const file = await workspacePath(ctx.ws, args.path);
        const info = await stat(file);
        if (!info.isFile()) return 'Ce chemin n\'est pas un fichier.';
        if (info.size > MAX_FILE) return `Fichier trop volumineux (${info.size} octets, ${MAX_FILE} max.).`;
        const buffer = await readFile(file);
        if (buffer.includes(0)) return 'Fichier binaire : non lu.';
        return cap(redactText(buffer.toString('utf8')));
      }

      case 'remember': {
        const note = typeof args.note === 'string' ? args.note.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim() : '';
        if (!note) return 'Note vide : rien enregistré.';
        const memory = await readMemory(ctx.ws.id);
        const next = `${memory.replace(/\s+$/, '')}${memory ? '\n' : ''}- ${note.slice(0, 500)}\n`;
        if (next.length > MAX_MEMORY) return 'Mémoire pleine : demande à l\'utilisateur de faire le tri.';
        await writeMemory(ctx.ws.id, next);
        return 'Noté.';
      }

      default:
        return `Outil inconnu : ${name}`;
    }
  } catch (err) {
    return `Erreur : ${err instanceof HttpError ? err.message : (err as Error).message}`;
  }
}
