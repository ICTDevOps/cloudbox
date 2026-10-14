// Boucle de l'assistant : appel du modèle, outils de lecture exécutés aussitôt, propositions de
// commande mises en attente de validation. Le déroulé est envoyé au portail en flux SSE :
//
//   event: text       { text }                         morceau de réponse
//   event: tool       { name, state: start|done }      outil de lecture
//   event: proposal   { proposal }                     commande à valider
//   event: executed   { id, command, session, output, finished }
//   event: error      { message }
//   event: done       { reason: end|awaiting|max_rounds|aborted|error }

import { randomBytes } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { checkInput, type Workspace } from '../lib.ts';
import type { ProviderConfig } from './config.ts';
import { chat, ProviderError, type ChatMessage } from './providers.ts';
import { redactText } from './redact.ts';
import { newProposalId, readAgentsFile, readMemory, saveConversation, type Conversation, type Proposal } from './store.ts';
import { cloudContext, runReadTool, TOOLS, type RunResult, type ToolContext } from './tools.ts';

const MAX_ROUNDS = 12;
// Budget de l'historique envoyé au modèle (caractères), les échanges les plus anciens sont omis
const HISTORY_BUDGET = 200_000;

export type Lang = 'fr' | 'en';

export class Sse {
  private readonly res: ServerResponse;
  closed = false;
  constructor(res: ServerResponse) {
    this.res = res;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    });
    // En-têtes envoyés tout de suite : le navigateur n'attend pas le premier événement (jusqu'à
    // 120 s pendant l'exécution d'une commande validée)
    res.flushHeaders();
    res.on('close', () => (this.closed = true));
  }
  send(event: string, data: unknown): void {
    if (this.closed) return;
    this.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  end(): void {
    if (!this.closed) this.res.end();
  }
}

export interface TurnOptions {
  ws: Workspace;
  conv: Conversation;
  provider: ProviderConfig & { apiKey: string };
  model: string;
  ctx: ToolContext;
  lang: Lang;
  sse: Sse;
  signal: AbortSignal;
}

function envLine(ws: Workspace): string {
  switch (ws.env) {
    case 'prd':
      return 'PRD (PRODUCTION). Prudence maximale : privilégie la lecture, annonce clairement tout effet ' +
        'd\'une commande qui modifie ou supprime, propose d\'abord une vérification (-WhatIf, --dry-run, what-if, plan).';
    case 'acc':
      return 'ACC (acceptation / préproduction).';
    default:
      return 'DEV (développement).';
  }
}

async function systemPrompt(o: TurnOptions): Promise<string> {
  const { ws, ctx } = o;
  const [context, memory, agents] = await Promise.all([cloudContext(), readMemory(ws.id), readAgentsFile(ws)]);
  const settings = Object.entries(ws.settings ?? {}).map(([k, v]) => `  - ${k} : ${v}`).join('\n') || '  (aucun)';
  const sessions = ctx.activeSession ? `Terminal actif de l'utilisateur : ${ctx.activeSession}` : 'Aucun terminal ouvert.';
  return [
    "Tu es l'assistant de Cloudbox, un poste d'administration Azure et Microsoft 365 dans le navigateur.",
    "Tu aides un administrateur pendant sa session de travail : diagnostic, commandes az, Az PowerShell, " +
      'Microsoft Graph, Exchange Online, Teams, PnP, kubectl, helm, OpenTofu/Terraform, Bicep, gh.',
    `Réponds en ${o.lang === 'en' ? 'anglais' : 'français'}, de façon concise, en Markdown simple.`,
    '',
    '## Workspace',
    `- Nom : ${ws.name} (identifiant ${ws.id})`,
    `- Environnement déclaré : ${envLine(ws)}`,
    `- Dossier de travail : ${ws.folder}`,
    `- Paramètres déclarés :\n${settings}`,
    `- ${sessions}`,
    '',
    '## Contexte réel (lu à l\'instant, fait foi sur les valeurs déclarées)',
    'Les connexions az, Az PowerShell et kubectl sont encore partagées entre tous les workspaces : ' +
      'si l\'abonnement ou le tenant réel diffère de celui déclaré, signale-le avant toute commande.',
    '```json',
    JSON.stringify(context, null, 2),
    '```',
    '',
    '## Règles',
    '- Tu ne lances rien toi-même : run_command propose une commande, l\'utilisateur la valide ou la refuse.',
    '- Une commande par proposition, sur une ligne, non interactive, adaptée au shell visé (pwsh ou bash).',
    '- Vérifie l\'état réel (get_context, read_terminal) plutôt que de supposer.',
    '- Les secrets sont masqués « [masqué] » : ne tente jamais de les reconstituer, n\'en demande pas, n\'en écris pas.',
    '- Après une commande, lis la sortie reçue et dis clairement si elle a réussi.',
    '- Si tu n\'es pas sûr d\'une option ou d\'une cmdlet, dis-le au lieu d\'inventer.',
    ...(memory ? ['', '## Mémoire de ce workspace (notes enregistrées)', memory] : []),
    ...(agents ? ['', '## Instructions de l\'utilisateur (AGENTS.md du workspace)', agents] : []),
  ].join('\n');
}

// Historique envoyé : les échanges les plus récents dans le budget, en commençant par un message de
// l'utilisateur (jamais par un résultat d'outil orphelin)
function windowed(messages: ChatMessage[]): ChatMessage[] {
  let size = 0;
  let start = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    size += m.role === 'tool' ? m.content.length : m.role === 'user' ? m.text.length : m.text.length + JSON.stringify(m.toolCalls ?? []).length;
    if (size > HISTORY_BUDGET && start < messages.length) break;
    start = i;
  }
  while (start < messages.length && messages[start].role !== 'user') start++;
  return messages.slice(start);
}

function pending(conv: Conversation): Proposal[] {
  return conv.proposals.filter((p) => p.status === 'pending');
}

function proposalFromCall(id: string, args: Record<string, unknown>): Proposal | string {
  const shell = args.shell === 'bash' ? 'bash' : args.shell === 'pwsh' ? 'pwsh' : null;
  if (!shell) return 'Erreur : shell invalide (pwsh ou bash).';
  let command: string;
  try {
    command = checkInput(typeof args.command === 'string' ? args.command.trim() : '');
  } catch {
    return 'Erreur : commande invalide (une seule ligne, sans caractère de contrôle, 2000 caractères max.).';
  }
  const reason = typeof args.reason === 'string' ? args.reason.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 300) : '';
  return { id: newProposalId(), callId: id, command, shell, reason, status: 'pending', created: new Date().toISOString() };
}

export async function runTurn(o: TurnOptions): Promise<void> {
  const { conv, sse, signal } = o;
  conv.provider = o.provider.id;
  conv.model = o.model;
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (pending(conv).length) {
        sse.send('done', { reason: 'awaiting' });
        return;
      }
      if (signal.aborted) {
        sse.send('done', { reason: 'aborted' });
        return;
      }
      const result = await chat({
        provider: o.provider,
        model: o.model,
        system: await systemPrompt(o),
        messages: windowed(conv.messages),
        tools: TOOLS,
        signal,
        onText: (text) => sse.send('text', { text }),
      });
      // Identifiants d'appel uniques dans la conversation (certains fournisseurs les répètent d'un
      // tour à l'autre) : résultats et propositions leur sont rattachés
      const used = new Set(conv.messages.flatMap((m) => (m.role === 'assistant' ? (m.toolCalls ?? []).map((c) => c.id) : [])));
      for (const call of result.toolCalls) {
        if (!call.id || used.has(call.id)) call.id = `call_${randomBytes(8).toString('hex')}`;
        used.add(call.id);
      }
      conv.messages.push({ role: 'assistant', text: result.text, ...(result.toolCalls.length ? { toolCalls: result.toolCalls } : {}) });
      if (!result.toolCalls.length) {
        await saveConversation(o.ws.id, conv);
        sse.send('done', { reason: 'end' });
        return;
      }
      const context = await cloudContext();
      for (const call of result.toolCalls) {
        if (call.name === 'run_command') {
          const p = proposalFromCall(call.id, call.args);
          if (typeof p === 'string') {
            conv.messages.push({ role: 'tool', callId: call.id, name: call.name, content: p });
          } else {
            p.context = context;
            conv.proposals.push(p);
            sse.send('proposal', { proposal: p });
          }
        } else {
          sse.send('tool', { name: call.name, state: 'start' });
          const content = await runReadTool(call.name, call.args, o.ctx);
          conv.messages.push({ role: 'tool', callId: call.id, name: call.name, content });
          sse.send('tool', { name: call.name, state: 'done' });
        }
      }
      await saveConversation(o.ws.id, conv);
    }
    sse.send('done', { reason: 'max_rounds' });
  } catch (err) {
    await saveConversation(o.ws.id, conv).catch(() => undefined);
    if (signal.aborted) {
      sse.send('done', { reason: 'aborted' });
      return;
    }
    const message = err instanceof ProviderError
      ? `${o.lang === 'en' ? 'Provider error' : 'Erreur du fournisseur'} (${err.status}) : ${redactText(err.message)}`
      : (err as Error).message;
    if (!(err instanceof ProviderError)) console.error('[cloudbox-api] assistant', err);
    sse.send('error', { message });
    sse.send('done', { reason: 'error' });
  }
}

// Nouveau message de l'utilisateur : les propositions encore en attente sont abandonnées
export function addUserMessage(conv: Conversation, text: string): void {
  for (const p of pending(conv)) {
    p.status = 'cancelled';
    p.decided = new Date().toISOString();
    conv.messages.push({ role: 'tool', callId: p.callId, name: 'run_command', content: "Non exécutée : l'utilisateur a poursuivi la conversation sans valider." });
  }
  conv.messages.push({ role: 'user', text: redactText(text) });
  if (!conv.title) conv.title = redactText(text).replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function recordExecution(conv: Conversation, p: Proposal, command: string, session: string, result: RunResult): string {
  const edited = command !== p.command ? ` (modifiée par l'utilisateur ; proposée : ${p.command})` : '';
  const status = !result.finished
    ? `\n[Toujours en cours après 120 s, ou sortie incomplète : relis le terminal ${session} avec read_terminal.]`
    : result.exitCode === null
      ? ''
      : `\n[Code de sortie : ${result.exitCode}${p.shell === 'pwsh' ? ' ($? de PowerShell : 0 succès, 1 échec)' : ''}]`;
  const content = `Commande exécutée dans ${session}${edited} :\n${result.output || '(aucune sortie)'}${status}`;
  conv.messages.push({ role: 'tool', callId: p.callId, name: 'run_command', content });
  return content;
}

export function recordRejection(conv: Conversation, p: Proposal, reason: string): void {
  const why = reason ? ` Motif : ${reason}` : '';
  conv.messages.push({ role: 'tool', callId: p.callId, name: 'run_command', content: `Refusée par l'utilisateur, non exécutée.${why}` });
}

export function checkReason(v: unknown): string {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string' || v.length > 500) return '';
  return redactText(v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim());
}
