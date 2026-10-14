// Routes de l'assistant IA (appelées par server.ts) :
//
//   GET    /api/assistant/config                     configuration (clés jamais renvoyées)
//   PUT    /api/assistant/config                     mise à jour partielle (voir config.ts)
//   GET    /api/assistant/models?provider=<id>       modèles proposés par le fournisseur
//   GET    /api/workspaces/:id/assistant             conversations, état (échange en cours)
//   POST   /api/workspaces/:id/assistant/conversations                  nouvelle conversation
//   GET    /api/workspaces/:id/assistant/conversations/:conv
//   DELETE /api/workspaces/:id/assistant/conversations/:conv
//   POST   /api/workspaces/:id/assistant/conversations/:conv/messages   { text, provider?, model?, activeSession? } → SSE
//   POST   …/conversations/:conv/proposals/:pid/approve   { session, command, confirmPrd? } → SSE
//   POST   …/conversations/:conv/proposals/:pid/reject    { reason?, activeSession? } → SSE
//   POST   /api/workspaces/:id/assistant/stop            arrête l'échange en cours
//   GET    /api/workspaces/:id/assistant/memory          { text }
//   PUT    /api/workspaces/:id/assistant/memory          { text }
//
// Un seul échange à la fois par workspace. Approve est le seul chemin de l'API qui envoie Entrée dans
// un terminal, après validation explicite de l'utilisateur (et confirmation supplémentaire en PRD).

import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { HttpError, checkId, checkInput, isRecord, loadWorkspace, readBody, send, type Workspace } from '../lib.ts';
import { addUserMessage, checkReason, recordExecution, recordRejection, runTurn, Sse, type Lang } from './agent.ts';
import { checkModel, ensureAllowed, findProvider, loadConfig, publicConfig, updateConfig, type AssistantConfig } from './config.ts';
import { listModels, ProviderError } from './providers.ts';
import {
  AGENTS_FILE, checkConversationId, checkProposalId, deleteConversation, ensureAgentsFile, listConversations, loadConversation,
  newConversation, readMemory, saveConversation, writeMemory, type Conversation,
} from './store.ts';
import { busyError, checkWorkspaceSession, runApproved, terminalIdle, type ToolContext } from './tools.ts';

const MAX_MESSAGE = 16_000;

// Échange en cours, par workspace
const active = new Map<string, AbortController>();

function lang(req: IncomingMessage): Lang {
  return /^en\b/i.test(req.headers['accept-language'] ?? '') ? 'en' : 'fr';
}

async function enabledConfig(): Promise<AssistantConfig> {
  ensureAllowed();
  const config = await loadConfig();
  if (!config.enabled) throw new HttpError(403, 'Assistant IA désactivé (« Assistant IA » dans la barre latérale)', 'AI assistant disabled (“AI assistant” in the sidebar)');
  return config;
}

function begin(ws: string): AbortController {
  if (active.has(ws)) throw new HttpError(409, 'Un échange est déjà en cours dans ce workspace', 'An exchange is already running in this workspace');
  const controller = new AbortController();
  active.set(ws, controller);
  return controller;
}

function finish(ws: string, controller: AbortController): void {
  if (active.get(ws) === controller) active.delete(ws);
}

export function abortWorkspace(ws: string): void {
  active.get(ws)?.abort();
}

function selection(config: AssistantConfig, conv: Conversation, body: Record<string, unknown>) {
  const providerId = typeof body.provider === 'string' && body.provider ? body.provider : conv.provider ?? config.default?.provider;
  const model = body.model !== undefined && body.model !== '' ? body.model : conv.model ?? config.default?.model;
  if (!providerId || !model) {
    throw new HttpError(400, 'Choisissez un fournisseur et un modèle', 'Choose a provider and a model');
  }
  return { provider: findProvider(config, providerId), model: checkModel(model) };
}

async function toolContext(ws: Workspace, v: unknown): Promise<ToolContext> {
  let activeSession: string | null = null;
  if (typeof v === 'string' && v) {
    try {
      activeSession = await checkWorkspaceSession(ws, v);
    } catch {
      activeSession = null; // terminal fermé entre-temps
    }
  }
  return { ws, activeSession };
}

// Lance la suite de l'échange dans le flux SSE, le verrou du workspace étant déjà pris
async function stream(
  res: ServerResponse,
  req: IncomingMessage,
  controller: AbortController,
  ws: Workspace,
  conv: Conversation,
  config: AssistantConfig,
  body: Record<string, unknown>,
  before?: (sse: Sse) => Promise<void>,
): Promise<void> {
  const sse = new Sse(res);
  // Onglet fermé ou requête interrompue : l'appel au fournisseur est arrêté
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  try {
    const { provider, model } = selection(config, conv, body);
    if (before) await before(sse);
    await runTurn({ ws, conv, provider, model, ctx: await toolContext(ws, body.activeSession), lang: lang(req), sse, signal: controller.signal });
  } catch (err) {
    await saveConversation(ws.id, conv).catch(() => undefined);
    const message = err instanceof HttpError ? err.text(req) : err instanceof ProviderError ? err.message : (err as Error).message;
    if (!(err instanceof HttpError)) console.error('[cloudbox-api] assistant', err);
    sse.send('error', { message });
    sse.send('done', { reason: 'error' });
  } finally {
    finish(ws.id, controller);
    sse.end();
  }
}

export async function handleAssistant(req: IncomingMessage, res: ServerResponse, parts: string[], url: URL): Promise<void> {
  const method = req.method ?? 'GET';

  // --- /api/assistant/… ---
  if (parts[1] === 'assistant') {
    const route = `${method} ${parts.slice(2).join('/')}`;
    switch (route) {
      case 'GET config':
        return send(res, 200, publicConfig(await loadConfig()));
      case 'PUT config': {
        ensureAllowed();
        return send(res, 200, publicConfig(await updateConfig(await readBody(req))));
      }
      case 'GET models': {
        ensureAllowed();
        const config = await loadConfig();
        const provider = findProvider(config, url.searchParams.get('provider') ?? '');
        try {
          return send(res, 200, { models: await listModels(provider) });
        } catch (err) {
          if (err instanceof ProviderError) {
            throw new HttpError(502, `Liste des modèles indisponible (${err.status}) : ${err.message}`, `Model list unavailable (${err.status}): ${err.message}`);
          }
          throw new HttpError(502, 'Fournisseur injoignable', 'Provider unreachable');
        }
      }
      default:
        throw new HttpError(404, 'Introuvable', 'Not found');
    }
  }

  // --- /api/workspaces/:id/assistant/… ---
  const ws = await loadWorkspace(checkId(parts[2]));
  const rest = parts.slice(4);
  const route = `${method} ${rest.map((p, i) => (i === 1 || i === 3 ? ':' : p)).join('/')}`;
  const config = await enabledConfig();

  switch (route) {
    case 'GET ': {
      return send(res, 200, {
        conversations: await listConversations(ws.id),
        busy: active.has(ws.id),
        agentsFile: path.join(ws.folder, AGENTS_FILE),
        default: config.default ?? null,
      });
    }

    case 'POST conversations': {
      const conv = newConversation();
      await ensureAgentsFile(ws);
      await saveConversation(ws.id, conv);
      return send(res, 201, conv);
    }

    case 'GET conversations/:':
      return send(res, 200, await loadConversation(ws.id, checkConversationId(rest[1])));

    case 'DELETE conversations/:': {
      if (active.has(ws.id)) throw new HttpError(409, 'Un échange est en cours', 'An exchange is running');
      await deleteConversation(ws.id, checkConversationId(rest[1]));
      return send(res, 204);
    }

    case 'POST conversations/:/messages': {
      const body = await readBody(req);
      if (!isRecord(body)) throw new HttpError(400, 'Objet JSON attendu', 'JSON object expected');
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text || text.length > MAX_MESSAGE) {
        throw new HttpError(400, `Message invalide (1 à ${MAX_MESSAGE} caractères)`, `Invalid message (1 to ${MAX_MESSAGE} characters)`);
      }
      const conv = await loadConversation(ws.id, checkConversationId(rest[1]));
      selection(config, conv, body); // erreurs de choix avant l'ouverture du flux
      const controller = begin(ws.id);
      addUserMessage(conv, text);
      await saveConversation(ws.id, conv);
      return stream(res, req, controller, ws, conv, config, body);
    }

    case 'POST conversations/:/proposals/:/approve':
    case 'POST conversations/:/proposals/:/reject': {
      const body = await readBody(req);
      if (!isRecord(body)) throw new HttpError(400, 'Objet JSON attendu', 'JSON object expected');
      const approve = rest[4] === 'approve';
      const conv = await loadConversation(ws.id, checkConversationId(rest[1]));
      const p = conv.proposals.find((x) => x.id === checkProposalId(rest[3]));
      if (!p) throw new HttpError(404, 'Proposition introuvable', 'Proposal not found');
      if (p.status !== 'pending') throw new HttpError(409, 'Proposition déjà traitée', 'Proposal already handled');

      // Validation complète avant l'ouverture du flux et avant toute saisie dans un terminal
      let command = p.command;
      let session = '';
      if (approve) {
        command = checkInput(typeof body.command === 'string' ? body.command.trim() : p.command);
        session = await checkWorkspaceSession(ws, body.session);
        if (!session.startsWith(`${ws.id}_${p.shell}_`)) {
          throw new HttpError(400, `Commande ${p.shell === 'pwsh' ? 'PowerShell' : 'Bash'} : choisissez un terminal ${p.shell}`,
            `${p.shell === 'pwsh' ? 'PowerShell' : 'Bash'} command: choose a ${p.shell} terminal`);
        }
        if (ws.env === 'prd' && body.confirmPrd !== true) {
          throw new HttpError(400, 'Workspace PRD : confirmation explicite requise', 'PRD workspace: explicit confirmation required');
        }
        if (!(await terminalIdle(session, p.shell))) throw busyError();
      }
      selection(config, conv, body);
      const controller = begin(ws.id);
      p.decided = new Date().toISOString();
      if (!approve) {
        p.status = 'rejected';
        p.note = checkReason(body.reason);
        recordRejection(conv, p, p.note);
        await saveConversation(ws.id, conv);
        return stream(res, req, controller, ws, conv, config, body);
      }
      // Statut enregistré avant l'exécution : une seconde validation (autre onglet) est refusée
      p.status = 'approved';
      p.executed = command;
      p.session = session;
      await saveConversation(ws.id, conv);
      return stream(res, req, controller, ws, conv, config, { ...body, activeSession: session }, async (sse) => {
        let result;
        try {
          result = await runApproved(session, p.shell, command, controller.signal);
        } catch (err) {
          // Saisie impossible (terminal fermé ou occupé entre-temps) : l'échec est rendu au modèle
          const message = err instanceof HttpError ? err.text(req) : (err as Error).message;
          result = { output: `Échec, commande non lancée : ${message}`, finished: true, exitCode: null };
          p.note = message;
        }
        recordExecution(conv, p, command, session, result);
        await saveConversation(ws.id, conv);
        sse.send('executed', { id: p.id, command, session, output: result.output, finished: result.finished, exitCode: result.exitCode });
      });
    }

    case 'POST stop':
      abortWorkspace(ws.id);
      return send(res, 204);

    case 'GET memory':
      return send(res, 200, { text: await readMemory(ws.id) });

    case 'PUT memory': {
      const body = await readBody(req);
      if (!isRecord(body) || typeof body.text !== 'string') throw new HttpError(400, 'Texte attendu', 'Text expected');
      await writeMemory(ws.id, body.text);
      return send(res, 204);
    }

    default:
      throw new HttpError(404, 'Introuvable', 'Not found');
  }
}
