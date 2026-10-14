// Outils communs de cloudbox-api : erreurs bilingues, validation, état des workspaces, tmux,
// contexte réel, lecture des requêtes. Utilisés par server.ts et par l'assistant (assistant/).

import { execFile } from 'node:child_process';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

// Répertoire de l'utilisateur dev (CLOUDBOX_HOME : uniquement pour exécuter l'API hors du container, en test)
export const HOME = process.env.CLOUDBOX_HOME ?? '/home/dev';
export const STATE_DIR = path.join(HOME, '.cloudbox', 'workspaces');
export const DEFAULT_ROOT = path.join(HOME, 'workspaces');
export const SOCKET = process.env.CLOUDBOX_API_SOCKET ?? '/run/cloudbox/api.sock';
export const MAX_BODY = 512 * 1024;

export const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const SHELLS = ['pwsh', 'bash'] as const;
export const ENVS = ['dev', 'acc', 'prd'] as const;
export type Env = (typeof ENVS)[number];
export const MAX_INPUT = 2000;

// Paramètres de connexion du workspace, repris dans les commandes du portail puis saisis dans un
// terminal : jeux de caractères stricts, aucune valeur ne peut sortir de son argument dans le shell
export const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SETTINGS_RULES: Record<string, { re: RegExp; message: Message }> = {
  tenant: {
    re: /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9]([a-z0-9-]{0,62}\.)+[a-z]{2,63})$/i,
    message: { fr: 'Tenant invalide : identifiant (GUID) ou domaine (contoso.onmicrosoft.com)', en: 'Invalid tenant: ID (GUID) or domain (contoso.onmicrosoft.com)' },
  },
  subscription: { re: GUID_RE, message: { fr: 'Abonnement invalide : identifiant (GUID) attendu', en: 'Invalid subscription: ID (GUID) expected' } },
  sharepointUrl: {
    re: /^https:\/\/[a-z0-9][a-z0-9-]{0,62}\.sharepoint\.(com|us|de|cn)(\/[A-Za-z0-9._~%/-]*)?$/i,
    message: { fr: 'URL SharePoint invalide : https://<tenant>.sharepoint.com[/sites/…]', en: 'Invalid SharePoint URL: https://<tenant>.sharepoint.com[/sites/…]' },
  },
  clientId: { re: GUID_RE, message: { fr: "ClientId invalide : identifiant d'application (GUID) attendu", en: 'Invalid ClientId: application ID (GUID) expected' } },
};
export type Settings = Partial<Record<keyof typeof SETTINGS_RULES, string>>;

export interface Workspace {
  id: string;
  name: string;
  env: Env;
  folder: string;
  // Compteur des panneaux terminal, tenu par le serveur : un numéro attribué n'est jamais réutilisé,
  // même avec plusieurs onglets ouverts sur le workspace
  nextPanel: number;
  settings?: Settings;
  // Panneaux ouverts à la première ouverture (tant qu'aucune disposition n'est enregistrée)
  initialPanels?: PanelKind[];
  // Fournisseur et modèle propres au workspace (sinon le modèle par défaut de l'assistant)
  assistant?: { provider: string; model: string };
  layout: unknown;
  created: string;
  updated: string;
}

// Messages d'erreur en français et en anglais : le portail envoie la langue de l'interface
// (Accept-Language), le français reste la langue par défaut
export interface Message {
  fr: string;
  en: string;
}

export class HttpError extends Error {
  readonly status: number;
  readonly en: string;
  constructor(status: number, fr: string, en: string = fr) {
    super(fr);
    this.status = status;
    this.en = en;
  }
  text(req: IncomingMessage): string {
    return /^en\b/i.test(req.headers['accept-language'] ?? '') ? this.en : this.message;
  }
}

// --- Utilitaires ---

// Verrou par workspace : lecture-modification-écriture du fichier sans entrelacement entre requêtes
const locks = new Map<string, Promise<unknown>>();
export function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  locks.set(id, next);
  next.finally(() => {
    if (locks.get(id) === next) locks.delete(id);
  }).catch(() => undefined);
  return next;
}

export function run(cmd: string, args: string[], timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

export async function readJson(file: string): Promise<unknown> {
  // Certains fichiers (azureProfile.json) commencent par un BOM UTF-8
  const text = (await readFile(file, 'utf8')).replace(/^﻿/, '');
  return JSON.parse(text);
}

export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  await rename(tmp, file);
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function checkId(id: string): string {
  if (!ID_RE.test(id)) throw new HttpError(400, 'Identifiant invalide (a-z, 0-9, tirets, 32 caractères max.)', 'Invalid ID (a-z, 0-9, hyphens, 32 characters max.)');
  return id;
}

export function checkName(v: unknown): string {
  if (typeof v !== 'string') throw new HttpError(400, 'Nom manquant', 'Missing name');
  const name = v.trim();
  if (name.length < 1 || name.length > 64 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new HttpError(400, 'Nom invalide (1 à 64 caractères)', 'Invalid name (1 to 64 characters)');
  }
  return name;
}

export function checkEnv(v: unknown): Env {
  if (typeof v === 'string' && (ENVS as readonly string[]).includes(v)) return v as Env;
  throw new HttpError(400, 'Environnement invalide (dev, acc ou prd)', 'Invalid environment (dev, acc or prd)');
}

// Remplace l'ensemble des paramètres ; une valeur vide retire le paramètre
export function checkSettings(v: unknown): Settings {
  if (!isRecord(v)) throw new HttpError(400, 'Paramètres invalides', 'Invalid settings');
  const settings: Settings = {};
  for (const [key, value] of Object.entries(v)) {
    const rule = SETTINGS_RULES[key];
    if (!rule) throw new HttpError(400, `Paramètre inconnu : ${key}`, `Unknown setting: ${key}`);
    if (value === undefined || value === null || value === '') continue;
    const text = typeof value === 'string' ? value.trim() : '';
    if (!rule.re.test(text)) throw new HttpError(400, rule.message.fr, rule.message.en);
    settings[key] = text;
  }
  return settings;
}

// Texte saisi dans un terminal : une ligne, sans caractère de contrôle (ni Entrée, ni séquence
// d'échappement), donc jamais exécuté sans validation de l'utilisateur
export function checkInput(v: unknown): string {
  if (typeof v !== 'string' || v.length < 1 || v.length > MAX_INPUT) {
    throw new HttpError(400, `Texte invalide (1 à ${MAX_INPUT} caractères)`, `Invalid text (1 to ${MAX_INPUT} characters)`);
  }
  if (/[\u0000-\u001f\u007f-\u009f]/.test(v)) throw new HttpError(400, 'Caractère de contrôle refusé', 'Control character rejected');
  return v;
}

// Dossier de travail : créé au besoin, résolu (liens compris) et obligatoirement sous /home/dev
export async function resolveFolder(v: unknown, id: string): Promise<string> {
  const raw = typeof v === 'string' && v.trim() !== '' ? v.trim() : path.join(DEFAULT_ROOT, id);
  const abs = path.resolve(HOME, raw);
  if (abs !== HOME && !abs.startsWith(HOME + '/')) throw new HttpError(400, 'Le dossier doit être sous /home/dev', 'The folder must be under /home/dev');
  await mkdir(abs, { recursive: true });
  const real = await realpath(abs);
  if (real !== HOME && !real.startsWith(HOME + '/')) throw new HttpError(400, 'Le dossier doit être sous /home/dev', 'The folder must be under /home/dev');
  return real;
}

// --- Préférences du portail (communes à tous les workspaces) ---

export const PANEL_KINDS = ['pwsh', 'bash', 'code', 'assistant'] as const;
export type PanelKind = (typeof PANEL_KINDS)[number];
export const THEMES = ['auto', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
export const PREFERENCES_FILE = path.join(HOME, '.cloudbox', 'preferences.json');

export interface Preferences {
  theme: Theme;
  newWorkspace: { env: Env; panels: PanelKind[] };
}

export function defaultPreferences(): Preferences {
  return { theme: 'auto', newWorkspace: { env: 'dev', panels: ['pwsh', 'code', 'bash'] } };
}

// Panneaux d'un nouveau workspace : au moins un, sans doublon, dans l'ordre reçu
export function checkPanels(v: unknown): PanelKind[] {
  const ok = Array.isArray(v) && v.length >= 1 && v.length <= PANEL_KINDS.length
    && v.every((k) => typeof k === 'string' && (PANEL_KINDS as readonly string[]).includes(k))
    && new Set(v).size === v.length;
  if (!ok) throw new HttpError(400, 'Panneaux invalides (pwsh, bash, code, assistant ; au moins un)', 'Invalid panels (pwsh, bash, code, assistant; at least one)');
  return v as PanelKind[];
}

export function checkTheme(v: unknown): Theme {
  if (typeof v === 'string' && (THEMES as readonly string[]).includes(v)) return v as Theme;
  throw new HttpError(400, 'Thème invalide (auto, light ou dark)', 'Invalid theme (auto, light or dark)');
}

// Fichier absent ou illisible : valeurs par défaut, champ par champ
export async function loadPreferences(): Promise<Preferences> {
  const prefs = defaultPreferences();
  let data: unknown;
  try {
    data = await readJson(PREFERENCES_FILE);
  } catch {
    return prefs;
  }
  if (!isRecord(data)) return prefs;
  try { prefs.theme = checkTheme(data.theme); } catch { /* défaut */ }
  if (isRecord(data.newWorkspace)) {
    try { prefs.newWorkspace.env = checkEnv(data.newWorkspace.env); } catch { /* défaut */ }
    try { prefs.newWorkspace.panels = checkPanels(data.newWorkspace.panels); } catch { /* défaut */ }
  }
  return prefs;
}

// Mise à jour partielle : seuls les champs présents sont validés et remplacés
export function applyPreferences(prefs: Preferences, body: unknown): Preferences {
  if (!isRecord(body)) throw new HttpError(400, 'Objet JSON attendu', 'JSON object expected');
  for (const key of Object.keys(body)) {
    if (key !== 'theme' && key !== 'newWorkspace') throw new HttpError(400, `Préférence inconnue : ${key}`, `Unknown preference: ${key}`);
  }
  const next: Preferences = { theme: prefs.theme, newWorkspace: { ...prefs.newWorkspace } };
  if ('theme' in body) next.theme = checkTheme(body.theme);
  if ('newWorkspace' in body) {
    const nw = body.newWorkspace;
    if (!isRecord(nw)) throw new HttpError(400, 'Préférences de workspace invalides', 'Invalid workspace preferences');
    if ('env' in nw) next.newWorkspace.env = checkEnv(nw.env);
    if ('panels' in nw) next.newWorkspace.panels = checkPanels(nw.panels);
  }
  return next;
}

export function stateFile(id: string): string {
  return path.join(STATE_DIR, `${checkId(id)}.json`);
}

export async function loadWorkspace(id: string): Promise<Workspace> {
  try {
    const data = await readJson(stateFile(id));
    if (!isRecord(data)) throw new Error('format');
    return data as unknown as Workspace;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, 'Workspace introuvable', 'Workspace not found');
    throw err;
  }
}

// --- tmux ---

export async function tmuxSessions(): Promise<string[]> {
  try {
    const out = await run('tmux', ['list-sessions', '-F', '#{session_name}']);
    return out.split('\n').filter(Boolean);
  } catch {
    return []; // pas de serveur tmux : aucune session
  }
}

// Sessions d'un workspace : <id>_<shell>_<n> ; « _ » n'est pas permis dans un identifiant,
// donc « client » ne capture jamais les sessions de « client-prd ».
export function sessionPattern(id: string): RegExp {
  return new RegExp(`^${id}_(${SHELLS.join('|')})_\\d{1,4}$`);
}

export async function workspaceSessions(id: string): Promise<string[]> {
  const re = sessionPattern(id);
  return (await tmuxSessions()).filter((s) => re.test(s));
}

export async function killSession(name: string): Promise<void> {
  // « =nom » : correspondance exacte, sans préfixe
  await run('tmux', ['kill-session', '-t', `=${name}`]).catch(() => undefined);
}

// --- Contexte réel ---

export async function azureCliContext(): Promise<Record<string, string> | null> {
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

export async function azPowerShellContext(): Promise<Record<string, string> | null> {
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

// Compte GitHub CLI : lu dans hosts.yml (forme simple écrite par gh), sans appel réseau
export async function githubContext(): Promise<Record<string, string> | null> {
  const dir = process.env.GH_CONFIG_DIR ?? path.join(HOME, '.config', 'gh');
  try {
    const text = await readFile(path.join(dir, 'hosts.yml'), 'utf8');
    const host = /^([A-Za-z0-9.-]+):\s*$/m.exec(text)?.[1];
    if (!host) return null;
    const user = /^\s+user:\s*(\S+)\s*$/m.exec(text)?.[1] ?? '';
    return { host, user };
  } catch {
    return null;
  }
}

export async function kubernetesContext(): Promise<Record<string, string> | null> {
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

export async function readBody(req: IncomingMessage): Promise<unknown> {
  const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'Content-Type: application/json requis', 'Content-Type: application/json required');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'Requête trop volumineuse', 'Request too large');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON invalide', 'Invalid JSON');
  }
}

export function send(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status, { 'Cache-Control': 'no-store' }).end();
    return;
  }
  const json = JSON.stringify(body);
  res
    .writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    .end(json);
}

export function summary(w: Workspace) {
  return { id: w.id, name: w.name, env: w.env, folder: w.folder, updated: w.updated };
}
