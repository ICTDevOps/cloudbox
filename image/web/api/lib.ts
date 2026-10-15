// Outils communs de cloudbox-api : erreurs bilingues, validation, état des workspaces, tmux,
// contexte réel, lecture des requêtes. Utilisés par server.ts et par l'assistant (assistant/).

import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

// Répertoire de l'utilisateur dev (CLOUDBOX_HOME : uniquement pour exécuter l'API hors du container, en test)
export const HOME = process.env.CLOUDBOX_HOME ?? '/home/dev';
export const STATE_DIR = path.join(HOME, '.cloudbox', 'workspaces');
// Connexions isolées d'un workspace (az, azd, gh, contexte Kubernetes) : un dossier par workspace
export const IDENTITY_ROOT = path.join(HOME, '.cloudbox', 'identities');
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
  // Connexions des terminaux du workspace : isolées (défaut, champ absent) ou partagées avec les
  // autres workspaces
  identities?: IdentityMode;
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

export function run(cmd: string, args: string[], timeoutMs = 5000, env?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const options = { timeout: timeoutMs, maxBuffer: 1024 * 1024, ...(env ? { env: { ...process.env, ...env } } : {}) };
    execFile(cmd, args, options, (err, stdout) => {
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

// Dossiers proposés par le sélecteur du formulaire de création : sous-dossiers d'un dossier de
// /home/dev (liens résolus, jamais au-dessus), sans les dossiers cachés (configurations, jetons)
export interface FolderList {
  path: string;
  parent: string | null;
  folders: string[];
}

const MAX_FOLDERS = 500;

export async function listFolders(v: unknown): Promise<FolderList> {
  const raw = typeof v === 'string' && v.trim() !== '' ? v.trim() : HOME;
  if (raw.length > 4096 || /[\x00-\x1f]/.test(raw)) throw new HttpError(400, 'Chemin invalide', 'Invalid path');
  let real: string;
  try {
    real = await realpath(path.resolve(HOME, raw));
  } catch {
    throw new HttpError(404, 'Dossier introuvable', 'Folder not found');
  }
  if (real !== HOME && !real.startsWith(HOME + '/')) throw new HttpError(400, 'Le dossier doit être sous /home/dev', 'The folder must be under /home/dev');
  let entries;
  try {
    entries = await readdir(real, { withFileTypes: true });
  } catch {
    throw new HttpError(404, 'Dossier illisible', 'Folder not readable');
  }
  const folders: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    let dir = e.isDirectory();
    if (!dir && e.isSymbolicLink()) {
      // Lien : retenu seulement s'il mène à un dossier sous /home/dev
      try {
        const target = await realpath(path.join(real, e.name));
        dir = (target === HOME || target.startsWith(HOME + '/')) && (await readdir(target).then(() => true, () => false));
      } catch {
        dir = false;
      }
    }
    if (dir) folders.push(e.name);
  }
  folders.sort((a, b) => a.localeCompare(b));
  return { path: real, parent: real === HOME ? null : path.dirname(real), folders: folders.slice(0, MAX_FOLDERS) };
}

// --- Préférences du portail (communes à tous les workspaces) ---

export const PANEL_KINDS = ['pwsh', 'bash', 'code', 'assistant'] as const;
export type PanelKind = (typeof PANEL_KINDS)[number];
export const THEMES = ['auto', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
export const PREFERENCES_FILE = path.join(HOME, '.cloudbox', 'preferences.json');

export const CURSOR_STYLES = ['block', 'bar', 'underline'] as const;
export type CursorStyle = (typeof CURSOR_STYLES)[number];

// Apparence des terminaux web (appliquée par la page ttyd à xterm.js) et barre de chemin du portail
export interface TerminalPrefs {
  fontFamily: string; // liste CSS de polices du poste ; vide = police par défaut de ttyd
  fontSize: number;
  lineHeight: number;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  theme: Theme; // auto = comme le portail
  pathBar: boolean;
}

export interface Preferences {
  theme: Theme;
  newWorkspace: { env: Env; panels: PanelKind[] };
  terminal: TerminalPrefs;
}

export function defaultTerminal(): TerminalPrefs {
  return { fontFamily: '', fontSize: 14, lineHeight: 1, cursorStyle: 'block', cursorBlink: false, theme: 'auto', pathBar: true };
}

export function defaultPreferences(): Preferences {
  return { theme: 'auto', newWorkspace: { env: 'dev', panels: ['pwsh', 'code', 'bash'] }, terminal: defaultTerminal() };
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

const FONT_FAMILY = /^[A-Za-z0-9 ,'"._-]{0,120}$/;

// Champs des préférences du terminal, validés un par un (mise à jour partielle)
const TERMINAL_FIELDS: { [K in keyof TerminalPrefs]: (v: unknown) => TerminalPrefs[K] } = {
  fontFamily: (v) => {
    if (typeof v === 'string' && FONT_FAMILY.test(v)) return v.trim();
    throw new HttpError(400, 'Police invalide (lettres, chiffres, espaces, virgules, guillemets ; 120 caractères au plus)',
      'Invalid font (letters, digits, spaces, commas, quotes; at most 120 characters)');
  },
  fontSize: (v) => {
    if (Number.isInteger(v) && (v as number) >= 8 && (v as number) <= 32) return v as number;
    throw new HttpError(400, 'Taille de police invalide (entier de 8 à 32)', 'Invalid font size (integer from 8 to 32)');
  },
  lineHeight: (v) => {
    if (typeof v === 'number' && v >= 1 && v <= 2) return Math.round(v * 100) / 100;
    throw new HttpError(400, 'Interligne invalide (de 1 à 2)', 'Invalid line height (from 1 to 2)');
  },
  cursorStyle: (v) => {
    if (typeof v === 'string' && (CURSOR_STYLES as readonly string[]).includes(v)) return v as CursorStyle;
    throw new HttpError(400, 'Curseur invalide (block, bar ou underline)', 'Invalid cursor (block, bar or underline)');
  },
  cursorBlink: (v) => {
    if (typeof v === 'boolean') return v;
    throw new HttpError(400, 'cursorBlink : booléen attendu', 'cursorBlink: boolean expected');
  },
  theme: (v) => checkTheme(v),
  pathBar: (v) => {
    if (typeof v === 'boolean') return v;
    throw new HttpError(400, 'pathBar : booléen attendu', 'pathBar: boolean expected');
  },
};

// Mise à jour partielle des préférences du terminal (strict : champ inconnu ou invalide → 400)
export function checkTerminal(current: TerminalPrefs, v: unknown): TerminalPrefs {
  if (!isRecord(v)) throw new HttpError(400, 'Préférences du terminal invalides', 'Invalid terminal preferences');
  const next = { ...current };
  for (const [key, value] of Object.entries(v)) {
    if (!Object.hasOwn(TERMINAL_FIELDS, key)) throw new HttpError(400, `Préférence du terminal inconnue : ${key}`, `Unknown terminal preference: ${key}`);
    const k = key as keyof TerminalPrefs;
    (next as Record<string, unknown>)[k] = TERMINAL_FIELDS[k](value);
  }
  return next;
}

// Lecture tolérante (fichier ancien ou modifié à la main) : un champ invalide garde sa valeur par défaut
function readTerminal(v: unknown): TerminalPrefs {
  let terminal = defaultTerminal();
  if (!isRecord(v)) return terminal;
  for (const [key, value] of Object.entries(v)) {
    try {
      terminal = checkTerminal(terminal, { [key]: value });
    } catch { /* défaut */ }
  }
  return terminal;
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
  prefs.terminal = readTerminal(data.terminal);
  return prefs;
}

// Mise à jour partielle : seuls les champs présents sont validés et remplacés
export function applyPreferences(prefs: Preferences, body: unknown): Preferences {
  if (!isRecord(body)) throw new HttpError(400, 'Objet JSON attendu', 'JSON object expected');
  for (const key of Object.keys(body)) {
    if (key !== 'theme' && key !== 'newWorkspace' && key !== 'terminal') throw new HttpError(400, `Préférence inconnue : ${key}`, `Unknown preference: ${key}`);
  }
  const next: Preferences = { theme: prefs.theme, newWorkspace: { ...prefs.newWorkspace }, terminal: { ...prefs.terminal } };
  if ('theme' in body) next.theme = checkTheme(body.theme);
  if ('newWorkspace' in body) {
    const nw = body.newWorkspace;
    if (!isRecord(nw)) throw new HttpError(400, 'Préférences de workspace invalides', 'Invalid workspace preferences');
    if ('env' in nw) next.newWorkspace.env = checkEnv(nw.env);
    if ('panels' in nw) next.newWorkspace.panels = checkPanels(nw.panels);
  }
  if ('terminal' in body) next.terminal = checkTerminal(next.terminal, body.terminal);
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

// --- Connexions par workspace ---
//
// En mode isolé, les terminaux du workspace reçoivent leurs propres dossiers de configuration
// (cloudbox-term pose les mêmes variables, à garder identiques) :
//   az CLI : AZURE_CONFIG_DIR   azd : AZD_CONFIG_DIR   gh : GH_CONFIG_DIR
//   kubectl : KUBECONFIG=<workspace>/kube/config:~/.kube/config ; le premier fichier reçoit le
//   contexte courant (use-context) et les clusters ajoutés par az aks get-credentials ; les clusters
//   de ~/.kube/config restent visibles partout, avec leur namespace (attribut du contexte, partagé).
// Az PowerShell n'a pas de dossier de contexte configurable : il reste partagé, et signalé comme tel.

export const IDENTITY_MODES = ['isolated', 'shared'] as const;
export type IdentityMode = (typeof IDENTITY_MODES)[number];
export const CONTEXT_TOOLS = ['azureCli', 'azPowerShell', 'kubernetes', 'github'] as const;
export type ContextTool = (typeof CONTEXT_TOOLS)[number];

export function identityMode(ws: Pick<Workspace, 'identities'>): IdentityMode {
  return ws.identities === 'shared' ? 'shared' : 'isolated';
}

export function checkIdentities(v: unknown): IdentityMode {
  if (typeof v === 'string' && (IDENTITY_MODES as readonly string[]).includes(v)) return v as IdentityMode;
  throw new HttpError(400, 'Connexions invalides (isolated ou shared)', 'Invalid sign-ins (isolated or shared)');
}

export function identityDir(id: string): string {
  return path.join(IDENTITY_ROOT, checkId(id));
}

// Variables d'environnement des terminaux du workspace (aucune en mode partagé)
export function identityEnv(ws: Pick<Workspace, 'id' | 'identities'>): Record<string, string> {
  if (identityMode(ws) === 'shared') return {};
  const dir = identityDir(ws.id);
  return {
    AZURE_CONFIG_DIR: path.join(dir, 'azure'),
    AZD_CONFIG_DIR: path.join(dir, 'azd'),
    GH_CONFIG_DIR: path.join(dir, 'gh'),
    KUBECONFIG: `${path.join(dir, 'kube', 'config')}:${path.join(HOME, '.kube', 'config')}`,
  };
}

// Outils dont la connexion est commune à tous les workspaces
export function sharedTools(ws: Pick<Workspace, 'identities'>): ContextTool[] {
  return identityMode(ws) === 'shared' ? [...CONTEXT_TOOLS] : ['azPowerShell'];
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

export interface TerminalState {
  session: string;
  cwd: string; // dossier courant du panneau tmux (celui du processus au premier plan)
  command: string;
  idle: boolean; // le shell attend une commande (rien ne tourne au premier plan)
  identities: IdentityMode; // connexions du terminal, fixées à son ouverture
}

// Dossier courant et commande en cours des terminaux d'un workspace (barre de chemin du portail).
// Le premier panneau tmux de chaque session : celui que montre le terminal web.
export async function workspaceTerminals(id: string): Promise<TerminalState[]> {
  const re = sessionPattern(id);
  let out: string;
  try {
    out = await run('tmux', ['list-panes', '-a', '-F', '#{session_name}\t#{window_index}\t#{pane_index}\t#{pane_current_path}\t#{pane_current_command}']);
  } catch {
    return []; // pas de serveur tmux : aucune session
  }
  const terminals = new Map<string, TerminalState>();
  for (const line of out.split('\n')) {
    const [session, , , cwd, command = ''] = line.split('\t');
    if (!session || !re.test(session) || terminals.has(session)) continue;
    const shell = session.split('_')[1];
    terminals.set(session, { session, cwd: cwd ?? '', command, idle: command === shell, identities: 'shared' });
  }
  const list = [...terminals.values()];
  await Promise.all(list.map(async (t) => (t.identities = await sessionIdentity(t.session))));
  return list;
}

export async function killSession(name: string): Promise<void> {
  // « =nom » : correspondance exacte, sans préfixe
  await run('tmux', ['kill-session', '-t', `=${name}`]).catch(() => undefined);
}

// --- Contexte réel ---

// env : variables d'un workspace isolé (identityEnv) ; sans elles, la configuration commune
export async function azureCliContext(env: Record<string, string> = {}): Promise<Record<string, string> | null> {
  const dir = env.AZURE_CONFIG_DIR ?? process.env.AZURE_CONFIG_DIR ?? path.join(HOME, '.azure');
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
export async function githubContext(env: Record<string, string> = {}): Promise<Record<string, string> | null> {
  const dir = env.GH_CONFIG_DIR ?? process.env.GH_CONFIG_DIR ?? path.join(HOME, '.config', 'gh');
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

export async function kubernetesContext(env: Record<string, string> = {}): Promise<Record<string, string> | null> {
  const kubeEnv = env.KUBECONFIG ? { KUBECONFIG: env.KUBECONFIG } : undefined;
  try {
    const context = (await run('kubectl', ['config', 'current-context'], 5000, kubeEnv)).trim();
    if (!context) return null;
    const namespace = (
      await run('kubectl', ['config', 'view', '--minify', '-o', 'jsonpath={..namespace}'], 5000, kubeEnv).catch(() => '')
    ).trim();
    return { context, namespace: namespace || 'default' };
  } catch {
    return null;
  }
}

// Contexte réel commun (accueil) ou d'un workspace : ce que ses terminaux utilisent réellement
export async function cloudContext(ws?: Workspace) {
  const env = ws ? identityEnv(ws) : {};
  const [azureCli, azPowerShell, kubernetes, github] = await Promise.all([
    azureCliContext(env),
    azPowerShellContext(),
    kubernetesContext(env),
    githubContext(env),
  ]);
  const shared = ws ? sharedTools(ws) : [...CONTEXT_TOOLS];
  return {
    azureCli, azPowerShell, kubernetes, github,
    identities: ws ? identityMode(ws) : ('shared' as IdentityMode),
    shared,
    sharedAcrossWorkspaces: shared.length === CONTEXT_TOOLS.length,
  };
}

// Mode des connexions d'un terminal, fixé à son ouverture (variable de session tmux posée par
// cloudbox-term) : un terminal ouvert avant l'isolation, ou avant un changement de mode, garde
// l'ancien. Sans la variable : terminal d'avant l'isolation, donc partagé.
export async function sessionIdentity(session: string): Promise<IdentityMode> {
  try {
    const out = (await run('tmux', ['show-environment', '-t', `=${session}`, 'CLOUDBOX_IDENTITIES'])).trim();
    return out === 'CLOUDBOX_IDENTITIES=isolated' ? 'isolated' : 'shared';
  } catch {
    return 'shared';
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
