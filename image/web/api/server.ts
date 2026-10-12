// cloudbox-api : API du portail (workspaces, sessions tmux, contexte réel).
// Node exécute ce fichier TypeScript directement (type stripping), sans dépendance externe.
// Écoute sur un socket UNIX ; Caddy est la seule porte (authentification, Host, Origin).
//
//   GET    /api/health
//   GET    /api/context                               contexte réel : az CLI, Az PowerShell, Kubernetes
//   GET    /api/workspaces                            liste (sans les dispositions)
//   POST   /api/workspaces                            création { id, name, env, folder? }
//   GET    /api/workspaces/:id                        workspace complet + sessions tmux actives
//   PUT    /api/workspaces/:id                        mise à jour partielle { name?, env?, layout?, nextPanel? }
//   DELETE /api/workspaces/:id                        suppression (le dossier de travail est conservé)
//   DELETE /api/workspaces/:id/sessions/:session      fermeture d'une session tmux du workspace
//
// Toute requête qui modifie l'état exige « Content-Type: application/json » : depuis une autre
// origine, le navigateur ne peut pas l'envoyer sans pré-vérification CORS, jamais accordée.

import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, realpath, rename, rm, writeFile, chmod } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';

const HOME = '/home/dev';
const STATE_DIR = path.join(HOME, '.cloudbox', 'workspaces');
const DEFAULT_ROOT = path.join(HOME, 'workspaces');
const SOCKET = process.env.CLOUDBOX_API_SOCKET ?? '/run/cloudbox/api.sock';
const MAX_BODY = 512 * 1024;

const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const SHELLS = ['pwsh', 'bash'] as const;
const ENVS = ['dev', 'acc', 'prd'] as const;
type Env = (typeof ENVS)[number];

interface Workspace {
  id: string;
  name: string;
  env: Env;
  folder: string;
  // Compteur des panneaux terminal : chaque panneau garde son numéro, donc sa session tmux
  nextPanel: number;
  layout: unknown;
  created: string;
  updated: string;
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// --- Utilitaires ---

function run(cmd: string, args: string[], timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

async function readJson(file: string): Promise<unknown> {
  // Certains fichiers (azureProfile.json) commencent par un BOM UTF-8
  const text = (await readFile(file, 'utf8')).replace(/^﻿/, '');
  return JSON.parse(text);
}

async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  await rename(tmp, file);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkId(id: string): string {
  if (!ID_RE.test(id)) throw new HttpError(400, 'Identifiant invalide (a-z, 0-9, tirets, 32 caractères max.)');
  return id;
}

function checkName(v: unknown): string {
  if (typeof v !== 'string') throw new HttpError(400, 'Nom manquant');
  const name = v.trim();
  if (name.length < 1 || name.length > 64 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new HttpError(400, 'Nom invalide (1 à 64 caractères)');
  }
  return name;
}

function checkEnv(v: unknown): Env {
  if (typeof v === 'string' && (ENVS as readonly string[]).includes(v)) return v as Env;
  throw new HttpError(400, 'Environnement invalide (dev, acc ou prd)');
}

// Dossier de travail : créé au besoin, résolu (liens compris) et obligatoirement sous /home/dev
async function resolveFolder(v: unknown, id: string): Promise<string> {
  const raw = typeof v === 'string' && v.trim() !== '' ? v.trim() : path.join(DEFAULT_ROOT, id);
  const abs = path.resolve(HOME, raw);
  if (abs !== HOME && !abs.startsWith(HOME + '/')) throw new HttpError(400, 'Le dossier doit être sous /home/dev');
  await mkdir(abs, { recursive: true });
  const real = await realpath(abs);
  if (real !== HOME && !real.startsWith(HOME + '/')) throw new HttpError(400, 'Le dossier doit être sous /home/dev');
  return real;
}

function stateFile(id: string): string {
  return path.join(STATE_DIR, `${checkId(id)}.json`);
}

async function loadWorkspace(id: string): Promise<Workspace> {
  try {
    const data = await readJson(stateFile(id));
    if (!isRecord(data)) throw new Error('format');
    return data as unknown as Workspace;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, 'Workspace introuvable');
    throw err;
  }
}

// --- tmux ---

async function tmuxSessions(): Promise<string[]> {
  try {
    const out = await run('tmux', ['list-sessions', '-F', '#{session_name}']);
    return out.split('\n').filter(Boolean);
  } catch {
    return []; // pas de serveur tmux : aucune session
  }
}

// Sessions d'un workspace : <id>_<shell>_<n> ; « _ » n'est pas permis dans un identifiant,
// donc « client » ne capture jamais les sessions de « client-prd ».
function sessionPattern(id: string): RegExp {
  return new RegExp(`^${id}_(${SHELLS.join('|')})_\\d{1,4}$`);
}

async function workspaceSessions(id: string): Promise<string[]> {
  const re = sessionPattern(id);
  return (await tmuxSessions()).filter((s) => re.test(s));
}

async function killSession(name: string): Promise<void> {
  // « =nom » : correspondance exacte, sans préfixe
  await run('tmux', ['kill-session', '-t', `=${name}`]).catch(() => undefined);
}

// --- Contexte réel ---

async function azureCliContext(): Promise<Record<string, string> | null> {
  const dir = process.env.AZURE_CONFIG_DIR ?? path.join(HOME, '.azure');
  try {
    const profile = await readJson(path.join(dir, 'azureProfile.json'));
    if (!isRecord(profile) || !Array.isArray(profile.subscriptions)) return null;
    const sub = profile.subscriptions.find((s: unknown) => isRecord(s) && s.isDefault === true);
    if (!isRecord(sub)) return null;
    const user = isRecord(sub.user) ? String(sub.user.name ?? '') : '';
    return {
      subscription: String(sub.name ?? ''),
      subscriptionId: String(sub.id ?? ''),
      tenantId: String(sub.tenantId ?? ''),
      user,
      cloud: String(sub.environmentName ?? ''),
    };
  } catch {
    return null;
  }
}

async function azPowerShellContext(): Promise<Record<string, string> | null> {
  try {
    const data = await readJson(path.join(HOME, '.Azure', 'AzureRmContext.json'));
    if (!isRecord(data) || !isRecord(data.Contexts) || typeof data.DefaultContextKey !== 'string') return null;
    const ctx = data.Contexts[data.DefaultContextKey];
    if (!isRecord(ctx)) return null;
    const sub = isRecord(ctx.Subscription) ? ctx.Subscription : {};
    const tenant = isRecord(ctx.Tenant) ? ctx.Tenant : {};
    const account = isRecord(ctx.Account) ? ctx.Account : {};
    const env = isRecord(ctx.Environment) ? ctx.Environment : {};
    if (!sub.Name && !account.Id) return null;
    return {
      subscription: String(sub.Name ?? ''),
      subscriptionId: String(sub.Id ?? ''),
      tenantId: String(tenant.Id ?? ''),
      user: String(account.Id ?? ''),
      cloud: String(env.Name ?? ''),
    };
  } catch {
    return null;
  }
}

async function kubernetesContext(): Promise<Record<string, string> | null> {
  try {
    const context = (await run('kubectl', ['config', 'current-context'])).trim();
    if (!context) return null;
    const namespace = (
      await run('kubectl', ['config', 'view', '--minify', '-o', 'jsonpath={..namespace}']).catch(() => '')
    ).trim();
    return { context, namespace: namespace || 'default' };
  } catch {
    return null;
  }
}

// --- Requêtes ---

async function readBody(req: IncomingMessage): Promise<unknown> {
  const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'Content-Type: application/json requis');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'Requête trop volumineuse');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON invalide');
  }
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status, { 'Cache-Control': 'no-store' }).end();
    return;
  }
  const json = JSON.stringify(body);
  res
    .writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    .end(json);
}

function summary(w: Workspace) {
  return { id: w.id, name: w.name, env: w.env, folder: w.folder, updated: w.updated };
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean); // ['api', …]
  const method = req.method ?? 'GET';
  if (parts[0] !== 'api') throw new HttpError(404, 'Introuvable');

  // Toute modification exige du JSON (voir l'en-tête du fichier)
  if (method !== 'GET' && method !== 'HEAD') {
    const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') throw new HttpError(415, 'Content-Type: application/json requis');
  }

  const route = `${method} /${parts.slice(1).map((p, i) => (i === 1 || i === 3 ? ':' : p)).join('/')}`;

  switch (route) {
    case 'GET /health':
      return send(res, 200, { ok: true });

    case 'GET /context': {
      const [azureCli, azPowerShell, kubernetes] = await Promise.all([
        azureCliContext(),
        azPowerShellContext(),
        kubernetesContext(),
      ]);
      // Jusqu'à l'isolation par workspace (étape 3), ce contexte est commun à tous les workspaces
      return send(res, 200, { azureCli, azPowerShell, kubernetes, sharedAcrossWorkspaces: true });
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
      if (!isRecord(body)) throw new HttpError(400, 'Objet JSON attendu');
      const id = checkId(String(body.id ?? ''));
      await mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
      try {
        await loadWorkspace(id);
        throw new HttpError(409, 'Un workspace porte déjà cet identifiant');
      } catch (err) {
        if (!(err instanceof HttpError) || err.status !== 404) throw err;
      }
      const now = new Date().toISOString();
      const ws: Workspace = {
        id,
        name: checkName(body.name),
        env: checkEnv(body.env),
        folder: await resolveFolder(body.folder, id),
        nextPanel: 1,
        layout: null,
        created: now,
        updated: now,
      };
      await writeJsonAtomic(stateFile(id), ws);
      return send(res, 201, ws);
    }

    case 'GET /workspaces/:': {
      const ws = await loadWorkspace(parts[2]);
      return send(res, 200, { ...ws, sessions: await workspaceSessions(ws.id) });
    }

    case 'PUT /workspaces/:': {
      const ws = await loadWorkspace(parts[2]);
      const body = await readBody(req);
      if (!isRecord(body)) throw new HttpError(400, 'Objet JSON attendu');
      if ('name' in body) ws.name = checkName(body.name);
      if ('env' in body) ws.env = checkEnv(body.env);
      if ('layout' in body) {
        if (body.layout !== null && !isRecord(body.layout)) throw new HttpError(400, 'Disposition invalide');
        ws.layout = body.layout;
      }
      if ('nextPanel' in body) {
        const n = Number(body.nextPanel);
        // Le compteur ne recule jamais : un numéro déjà attribué n'est jamais réutilisé
        if (!Number.isInteger(n) || n < 1 || n > 9999) throw new HttpError(400, 'nextPanel invalide');
        ws.nextPanel = Math.max(ws.nextPanel, n);
      }
      ws.updated = new Date().toISOString();
      await writeJsonAtomic(stateFile(ws.id), ws);
      return send(res, 200, summary(ws));
    }

    case 'DELETE /workspaces/:': {
      const ws = await loadWorkspace(parts[2]);
      for (const s of await workspaceSessions(ws.id)) await killSession(s);
      await rm(stateFile(ws.id), { force: true });
      // Le dossier de travail n'est jamais supprimé
      return send(res, 204);
    }

    case 'DELETE /workspaces/:/sessions/:': {
      const ws = await loadWorkspace(parts[2]);
      const session = parts[4];
      if (!sessionPattern(ws.id).test(session)) throw new HttpError(400, 'Session invalide');
      await killSession(session);
      return send(res, 204);
    }

    default:
      throw new HttpError(404, 'Introuvable');
  }
}

const server = createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    if (err instanceof HttpError) {
      send(res, err.status, { error: err.message });
    } else {
      console.error('[cloudbox-api]', err);
      send(res, 500, { error: 'Erreur interne' });
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
