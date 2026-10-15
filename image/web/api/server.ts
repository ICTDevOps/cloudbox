// cloudbox-api : API du portail (workspaces, sessions tmux, contexte réel).
// Node exécute ce fichier TypeScript directement (type stripping), sans dépendance externe.
// Écoute sur un socket UNIX ; Caddy est la seule porte (authentification, Host, Origin).
//
//   GET    /api/health
//   GET    /api/context                               contexte réel commun : az CLI, Az PowerShell, Kubernetes, GitHub
//   GET    /api/folders?path=…                       sous-dossiers d'un dossier de /home/dev (sélecteur, sans les cachés)
//   GET    /api/preferences                           préférences du portail (thème, nouveau workspace)
//   PUT    /api/preferences                           mise à jour partielle { theme?, newWorkspace?: { env?, panels? },
//                                                     terminal?: { fontFamily?, fontSize?, lineHeight?, cursorStyle?,
//                                                     cursorBlink?, theme?, pathBar? } }
//   GET    /api/workspaces                            liste (sans les dispositions)
//   POST   /api/workspaces                            création { id, name, env, folder?, panels?, identities? }
//   GET    /api/workspaces/:id                        workspace complet + sessions tmux actives
//   GET    /api/workspaces/:id/context                contexte réel des terminaux du workspace (connexions isolées ou partagées)
//   GET    /api/workspaces/:id/terminals              dossier courant, commande en cours et connexions de ses terminaux
//   PUT    /api/workspaces/:id                        mise à jour partielle { name?, env?, layout?, settings?, assistant?, identities? }
//   POST   /api/workspaces/:id/panels                 attribue un numéro de panneau terminal { n }
//   DELETE /api/workspaces/:id                        suppression, connexions isolées comprises (le dossier de travail est conservé)
//   DELETE /api/workspaces/:id/sessions/:session      fermeture d'une session tmux du workspace
//   POST   /api/workspaces/:id/sessions/:session/input  saisie d'un texte dans la session { text },
//                                                     sans Entrée : l'utilisateur relit et valide
//   …      /api/assistant/…, /api/workspaces/:id/assistant/…   assistant IA (assistant/routes.ts)
//
// Toute requête qui modifie l'état exige « Content-Type: application/json » : depuis une autre
// origine, le navigateur ne peut pas l'envoyer sans pré-vérification CORS, jamais accordée.

import { chmod, mkdir, readdir, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import {
  HttpError, ID_RE, PREFERENCES_FILE, SOCKET, STATE_DIR, applyPreferences, checkEnv, checkId, checkIdentities, checkInput, checkName,
  checkPanels, checkSettings, cloudContext, identityDir, identityMode, isRecord, killSession, loadPreferences, loadWorkspace, readBody, resolveFolder, run, send,
  listFolders, sessionPattern, stateFile, summary, withLock, workspaceSessions, workspaceTerminals, writeJsonAtomic, type Workspace,
} from './lib.ts';
import { checkWorkspaceAssistant } from './assistant/config.ts';
import { abortWorkspace, handleAssistant } from './assistant/routes.ts';
import { deleteWorkspaceData } from './assistant/store.ts';

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean); // ['api', …]
  const method = req.method ?? 'GET';
  if (parts[0] !== 'api') throw new HttpError(404, 'Introuvable', 'Not found');

  // Toute modification exige du JSON (voir l'en-tête du fichier)
  if (method !== 'GET' && method !== 'HEAD') {
    const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') throw new HttpError(415, 'Content-Type: application/json requis', 'Content-Type: application/json required');
  }

  // Assistant IA : /api/assistant/… et /api/workspaces/:id/assistant/…
  if (parts[1] === 'assistant' || (parts[1] === 'workspaces' && parts[3] === 'assistant')) {
    return handleAssistant(req, res, parts, url);
  }

  const route = `${method} /${parts.slice(1).map((p, i) => (i === 1 || i === 3 ? ':' : p)).join('/')}`;

  switch (route) {
    case 'GET /health':
      return send(res, 200, { ok: true });

    case 'GET /folders': {
      return send(res, 200, await listFolders(url.searchParams.get('path')));
    }

    case 'GET /context':
      // Connexions communes (accueil, VS Code, docker exec, workspaces en mode partagé)
      return send(res, 200, await cloudContext());

    case 'GET /preferences':
      return send(res, 200, await loadPreferences());

    case 'PUT /preferences': {
      const body = await readBody(req);
      const prefs = await withLock('.preferences', async () => {
        const next = applyPreferences(await loadPreferences(), body);
        await mkdir(path.dirname(PREFERENCES_FILE), { recursive: true, mode: 0o700 });
        await writeJsonAtomic(PREFERENCES_FILE, next);
        return next;
      });
      return send(res, 200, prefs);
    }

    case 'GET /workspaces': {
      await mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
      const files = (await readdir(STATE_DIR)).filter((f) => f.endsWith('.json'));
      const list = [];
      for (const f of files) {
        const id = f.slice(0, -5);
        if (!ID_RE.test(id)) continue;
        try {
          list.push(summary(await loadWorkspace(id)));
        } catch {
          // fichier illisible : ignoré dans la liste
        }
      }
      list.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      return send(res, 200, list);
    }

    case 'POST /workspaces': {
      const body = await readBody(req);
      if (!isRecord(body)) throw new HttpError(400, 'Objet JSON attendu', 'JSON object expected');
      const id = checkId(String(body.id ?? ''));
      const panels = body.panels === undefined ? (await loadPreferences()).newWorkspace.panels : checkPanels(body.panels);
      const ws = await withLock(id, async () => {
        await mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
        try {
          await loadWorkspace(id);
          throw new HttpError(409, 'Un workspace porte déjà cet identifiant', 'A workspace already uses this ID');
        } catch (err) {
          if (!(err instanceof HttpError) || err.status !== 404) throw err;
        }
        const now = new Date().toISOString();
        const created: Workspace = {
          id,
          name: checkName(body.name),
          env: checkEnv(body.env),
          folder: await resolveFolder(body.folder, id),
          nextPanel: 1,
          initialPanels: panels,
          identities: body.identities === undefined ? 'isolated' : checkIdentities(body.identities),
          layout: null,
          created: now,
          updated: now,
        };
        await writeJsonAtomic(stateFile(id), created);
        return created;
      });
      return send(res, 201, ws);
    }

    case 'GET /workspaces/:': {
      const ws = await loadWorkspace(parts[2]);
      return send(res, 200, { ...ws, sessions: await workspaceSessions(ws.id) });
    }

    case 'GET /workspaces/:/context': {
      const ws = await loadWorkspace(parts[2]);
      return send(res, 200, await cloudContext(ws));
    }

    case 'GET /workspaces/:/terminals': {
      const ws = await loadWorkspace(parts[2]);
      // identities : mode attendu ; un terminal d'un autre mode est à rouvrir (signalé par la barre de chemin)
      return send(res, 200, { terminals: await workspaceTerminals(ws.id), identities: identityMode(ws) });
    }

    case 'PUT /workspaces/:': {
      const body = await readBody(req);
      if (!isRecord(body)) throw new HttpError(400, 'Objet JSON attendu', 'JSON object expected');
      const ws = await withLock(checkId(parts[2]), async () => {
        const w = await loadWorkspace(parts[2]);
        if ('name' in body) w.name = checkName(body.name);
        if ('env' in body) w.env = checkEnv(body.env);
        if ('settings' in body) w.settings = checkSettings(body.settings);
        // Les terminaux déjà ouverts gardent leur mode jusqu'à leur fermeture (signalé dans le portail)
        if ('identities' in body) w.identities = checkIdentities(body.identities);
        if ('assistant' in body) {
          const a = checkWorkspaceAssistant(body.assistant);
          if (a) w.assistant = a;
          else delete w.assistant;
        }
        if ('layout' in body) {
          if (body.layout !== null && !isRecord(body.layout)) throw new HttpError(400, 'Disposition invalide', 'Invalid layout');
          // Plusieurs onglets sur le même workspace : la dernière disposition enregistrée l'emporte
          w.layout = body.layout;
        }
        w.updated = new Date().toISOString();
        await writeJsonAtomic(stateFile(w.id), w);
        return w;
      });
      return send(res, 200, summary(ws));
    }

    case 'POST /workspaces/:/panels': {
      const n = await withLock(checkId(parts[2]), async () => {
        const w = await loadWorkspace(parts[2]);
        const allocated = Math.max(1, Number(w.nextPanel) || 1);
        if (allocated > 9999) throw new HttpError(409, 'Plus de numéro de panneau disponible', 'No panel number left');
        w.nextPanel = allocated + 1;
        await writeJsonAtomic(stateFile(w.id), w);
        return allocated;
      });
      return send(res, 201, { n });
    }

    case 'DELETE /workspaces/:': {
      const ws = await withLock(checkId(parts[2]), async () => {
        const w = await loadWorkspace(parts[2]);
        await rm(stateFile(w.id), { force: true });
        return w;
      });
      for (const s of await workspaceSessions(ws.id)) await killSession(s);
      // Conversations et mémoire de l'assistant supprimées ; le dossier de travail (et son AGENTS.md)
      // n'est jamais supprimé
      abortWorkspace(ws.id);
      await deleteWorkspaceData(ws.id);
      // Connexions isolées (jetons az, gh, azd, contexte Kubernetes) supprimées avec le workspace
      await rm(identityDir(ws.id), { recursive: true, force: true });
      return send(res, 204);
    }

    case 'DELETE /workspaces/:/sessions/:': {
      const ws = await loadWorkspace(parts[2]);
      const session = parts[4];
      if (!sessionPattern(ws.id).test(session)) throw new HttpError(400, 'Session invalide', 'Invalid session');
      await killSession(session);
      return send(res, 204);
    }

    case 'POST /workspaces/:/sessions/:/input': {
      const ws = await loadWorkspace(parts[2]);
      const session = parts[4];
      if (!sessionPattern(ws.id).test(session)) throw new HttpError(400, 'Session invalide', 'Invalid session');
      const body = await readBody(req);
      const text = checkInput(isRecord(body) ? body.text : undefined);
      // -l : texte littéral (aucun nom de touche interprété) ; « =nom: » : session exacte
      await run('tmux', ['send-keys', '-t', `=${session}:`, '-l', '--', text]).catch(() => {
        throw new HttpError(404, 'Session introuvable (terminal fermé ?)', 'Session not found (terminal closed?)');
      });
      return send(res, 204);
    }

    default:
      throw new HttpError(404, 'Introuvable', 'Not found');
  }
}

const server = createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    if (err instanceof HttpError) {
      send(res, err.status, { error: err.text(req) });
    } else {
      console.error('[cloudbox-api]', err);
      send(res, 500, { error: new HttpError(500, 'Erreur interne', 'Internal error').text(req) });
    }
  });
});

await rm(SOCKET, { force: true });
server.listen(SOCKET, () => {
  chmod(SOCKET, 0o600).catch(() => undefined);
  console.log(`[cloudbox-api] à l'écoute sur ${SOCKET}`);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
