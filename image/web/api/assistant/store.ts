// Stockage de l'assistant, propre à chaque workspace (jamais de mélange entre deux clients) :
//
//   /home/dev/.cloudbox/assistant/workspaces/<id>/conversations/<conv>.json   messages masqués, propositions
//   /home/dev/.cloudbox/assistant/workspaces/<id>/memory.md                   notes de l'assistant (modifiables)
//   <dossier du workspace>/AGENTS.md                                          instructions écrites par l'utilisateur
//
// Les champs dynamiques (environnement, tenant, contexte réel) ne sont pas écrits dans AGENTS.md :
// ils sont injectés à chaque échange.

import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HttpError, checkId, isRecord, readJson, writeJsonAtomic, type Workspace } from '../lib.ts';
import { ASSISTANT_DIR } from './config.ts';
import type { ChatMessage } from './providers.ts';
import { redactText } from './redact.ts';

const CONV_RE = /^[a-z0-9]{8,32}$/;
const PROPOSAL_RE = /^p[a-z0-9]{8,24}$/;
const MAX_CONVERSATIONS = 50;
export const MAX_MEMORY = 8 * 1024;
const MAX_AGENTS_FILE = 16 * 1024;
export const AGENTS_FILE = 'AGENTS.md';

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface Proposal {
  id: string; // identifiant court, utilisé dans les URL
  callId: string; // identifiant de l'appel d'outil chez le fournisseur
  command: string;
  shell: 'pwsh' | 'bash';
  reason: string;
  status: ProposalStatus;
  created: string;
  decided?: string;
  // Commande réellement lancée (l'utilisateur peut la modifier avant de valider) et terminal
  executed?: string;
  session?: string;
  note?: string;
  // Contexte réel au moment de la proposition (trace)
  context?: unknown;
}

export interface Conversation {
  id: string;
  title: string;
  created: string;
  updated: string;
  provider?: string;
  model?: string;
  messages: ChatMessage[];
  proposals: Proposal[];
}

function workspaceDir(ws: string): string {
  return path.join(ASSISTANT_DIR, 'workspaces', checkId(ws));
}

function conversationsDir(ws: string): string {
  return path.join(workspaceDir(ws), 'conversations');
}

export function checkConversationId(id: string): string {
  if (!CONV_RE.test(id)) throw new HttpError(400, 'Conversation invalide', 'Invalid conversation');
  return id;
}

export function newProposalId(): string {
  return 'p' + randomBytes(6).toString('hex');
}

export function checkProposalId(id: string): string {
  if (!PROPOSAL_RE.test(id)) throw new HttpError(400, 'Proposition invalide', 'Invalid proposal');
  return id;
}

function conversationFile(ws: string, id: string): string {
  return path.join(conversationsDir(ws), `${checkConversationId(id)}.json`);
}

export function newConversation(): Conversation {
  const now = new Date().toISOString();
  const id = Date.now().toString(36) + randomBytes(4).toString('hex');
  return { id, title: '', created: now, updated: now, messages: [], proposals: [] };
}

export async function loadConversation(ws: string, id: string): Promise<Conversation> {
  try {
    const data = await readJson(conversationFile(ws, id));
    if (!isRecord(data) || !Array.isArray(data.messages)) throw new Error('format');
    const c = data as unknown as Conversation;
    c.proposals = Array.isArray(c.proposals) ? c.proposals : [];
    return c;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, 'Conversation introuvable', 'Conversation not found');
    throw err;
  }
}

export async function saveConversation(ws: string, c: Conversation): Promise<void> {
  await mkdir(conversationsDir(ws), { recursive: true, mode: 0o700 });
  c.updated = new Date().toISOString();
  await writeJsonAtomic(conversationFile(ws, c.id), c);
}

export async function listConversations(ws: string) {
  let files: string[] = [];
  try {
    files = (await readdir(conversationsDir(ws))).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const list = [];
  for (const f of files) {
    const id = f.slice(0, -5);
    if (!CONV_RE.test(id)) continue;
    try {
      const c = await loadConversation(ws, id);
      list.push({ id: c.id, title: c.title, updated: c.updated, pending: c.proposals.filter((p) => p.status === 'pending').length });
    } catch {
      // conversation illisible : ignorée
    }
  }
  list.sort((a, b) => b.updated.localeCompare(a.updated));
  // Au-delà de la limite, les plus anciennes sont supprimées
  for (const old of list.splice(MAX_CONVERSATIONS)) await rm(conversationFile(ws, old.id), { force: true });
  return list;
}

export async function deleteConversation(ws: string, id: string): Promise<void> {
  await rm(conversationFile(ws, id), { force: true });
}

// Suppression du workspace : conversations et mémoire supprimées, AGENTS.md conservé (dossier de travail)
export async function deleteWorkspaceData(ws: string): Promise<void> {
  await rm(workspaceDir(ws), { recursive: true, force: true });
}

// --- Mémoire ---

export async function readMemory(ws: string): Promise<string> {
  try {
    return (await readFile(path.join(workspaceDir(ws), 'memory.md'), 'utf8')).slice(0, MAX_MEMORY);
  } catch {
    return '';
  }
}

export async function writeMemory(ws: string, text: string): Promise<void> {
  if (text.length > MAX_MEMORY) throw new HttpError(413, `Mémoire limitée à ${MAX_MEMORY} caractères`, `Memory limited to ${MAX_MEMORY} characters`);
  await mkdir(workspaceDir(ws), { recursive: true, mode: 0o700 });
  await writeFile(path.join(workspaceDir(ws), 'memory.md'), redactText(text), { mode: 0o600 });
}

// --- AGENTS.md ---

const AGENTS_TEMPLATE = `# Notes pour l'assistant

<!-- Lu par l'assistant IA de Cloudbox à chaque échange dans ce workspace (et par les agents CLI).
     L'environnement, le tenant et le contexte réel sont ajoutés automatiquement : inutile de les écrire ici.
     Ne mettez jamais de secret dans ce fichier. -->

## Client et périmètre

## Conventions (nommage, tags, régions)

## Ressources importantes

## À ne jamais faire
`;

async function agentsPath(ws: Workspace): Promise<string | null> {
  const file = path.join(ws.folder, AGENTS_FILE);
  try {
    // Pas de lien symbolique : le fichier doit rester dans le dossier du workspace
    if ((await lstat(file)).isSymbolicLink()) return null;
  } catch {
    // absent
  }
  return file;
}

export async function ensureAgentsFile(ws: Workspace): Promise<void> {
  const file = await agentsPath(ws);
  if (!file) return;
  await writeFile(file, AGENTS_TEMPLATE, { flag: 'wx', mode: 0o644 }).catch(() => undefined); // déjà présent
}

export async function readAgentsFile(ws: Workspace): Promise<string> {
  const file = await agentsPath(ws);
  if (!file) return '';
  try {
    const text = await readFile(file, 'utf8');
    if (text === AGENTS_TEMPLATE) return '';
    return redactText(text.slice(0, MAX_AGENTS_FILE));
  } catch {
    return '';
  }
}
