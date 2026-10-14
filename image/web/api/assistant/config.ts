// Configuration de l'assistant IA : fournisseurs (clé API), modèle par défaut, activation.
//
//   /home/dev/.cloudbox/assistant/config.json  (0600)
//
// Les clés ne repartent jamais vers le navigateur : publicConfig() n'en donne que la présence et
// les 4 derniers caractères. Une clé fournie par l'environnement du container
// (CLOUDBOX_<FOURNISSEUR>_API_KEY) prime sur celle du fichier et n'y est jamais écrite.
// CLOUDBOX_ASSISTANT=off interdit l'assistant (politique d'entreprise), quelle que soit la config.
//
// Abonnements Claude / ChatGPT : impossibles ici (le jeton d'un abonnement n'est utilisable que par
// les applications de l'éditeur) ; ils passent par le panneau « Agent CLI » (Claude Code, Codex CLI).

import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { HOME, HttpError, isRecord, readJson, writeJsonAtomic } from '../lib.ts';
import { setKnownSecrets } from './redact.ts';

export const ASSISTANT_DIR = path.join(HOME, '.cloudbox', 'assistant');
const CONFIG_FILE = path.join(ASSISTANT_DIR, 'config.json');

export const PROVIDER_TYPES = ['openai-compatible', 'anthropic'] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];
// En-tête d'authentification d'un point d'accès compatible OpenAI : « Authorization: Bearer »
// (OpenRouter, OpenAI) ou « api-key » (Azure OpenAI)
export const AUTH_MODES = ['bearer', 'api-key'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export interface ProviderConfig {
  id: string;
  type: ProviderType;
  label?: string;
  baseUrl: string;
  auth?: AuthMode;
  apiKey?: string;
}

export interface AssistantConfig {
  enabled: boolean;
  providers: ProviderConfig[];
  default?: { provider: string; model: string };
}

// Fournisseurs proposés d'office (sans clé) : il suffit de saisir la clé dans les paramètres
export const PRESETS: Record<string, Omit<ProviderConfig, 'apiKey'>> = {
  openrouter: { id: 'openrouter', type: 'openai-compatible', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', auth: 'bearer' },
  anthropic: { id: 'anthropic', type: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1' },
  openai: { id: 'openai', type: 'openai-compatible', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', auth: 'bearer' },
};

const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
// Identifiant de modèle : jeu de caractères des fournisseurs (anthropic/claude-…, gpt-…:free, déploiement Azure)
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/;
const MAX_KEY = 512;

export function assistantForbidden(): boolean {
  return /^(off|false|0|no)$/i.test(process.env.CLOUDBOX_ASSISTANT ?? '');
}

export function ensureAllowed(): void {
  if (assistantForbidden()) {
    throw new HttpError(403, "Assistant IA désactivé sur ce poste (CLOUDBOX_ASSISTANT=off)", 'AI assistant disabled on this machine (CLOUDBOX_ASSISTANT=off)');
  }
}

function envKey(id: string): string | undefined {
  const v = process.env[`CLOUDBOX_${id.toUpperCase().replace(/-/g, '_')}_API_KEY`];
  return v && v.trim() ? v.trim() : undefined;
}

// URL de base : https uniquement, sans identifiants ni query. http n'est accepté que pour le test de
// fumée (faux fournisseur local, CLOUDBOX_ASSISTANT_ALLOW_HTTP=1).
export function checkBaseUrl(v: unknown): string {
  const fail = () => new HttpError(400, 'URL du fournisseur invalide (https://…, sans identifiants)', 'Invalid provider URL (https://…, no credentials)');
  if (typeof v !== 'string' || v.length > 256) throw fail();
  let url: URL;
  try {
    url = new URL(v.trim());
  } catch {
    throw fail();
  }
  const httpAllowed = process.env.CLOUDBOX_ASSISTANT_ALLOW_HTTP === '1' && url.protocol === 'http:' && url.hostname === '127.0.0.1';
  if ((url.protocol !== 'https:' && !httpAllowed) || url.username || url.password || url.search || url.hash) throw fail();
  return url.toString().replace(/\/+$/, '');
}

export function checkModel(v: unknown): string {
  if (typeof v !== 'string' || !MODEL_RE.test(v.trim())) throw new HttpError(400, 'Identifiant de modèle invalide', 'Invalid model ID');
  return v.trim();
}

function checkProviderId(v: unknown): string {
  if (typeof v !== 'string' || !PROVIDER_ID_RE.test(v)) {
    throw new HttpError(400, 'Identifiant de fournisseur invalide (a-z, 0-9, tirets)', 'Invalid provider ID (a-z, 0-9, hyphens)');
  }
  return v;
}

function checkKey(v: unknown): string {
  if (typeof v !== 'string' || v.trim().length < 8 || v.length > MAX_KEY || /[\s\u0000-\u001f\u007f]/.test(v.trim())) {
    throw new HttpError(400, 'Clé API invalide', 'Invalid API key');
  }
  return v.trim();
}

export async function loadConfig(): Promise<AssistantConfig> {
  let data: unknown = null;
  try {
    data = await readJson(CONFIG_FILE);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error('[cloudbox-api] config assistant illisible', err);
  }
  const config: AssistantConfig = { enabled: false, providers: [] };
  if (isRecord(data)) {
    config.enabled = data.enabled === true;
    if (Array.isArray(data.providers)) {
      for (const p of data.providers) {
        if (!isRecord(p) || typeof p.id !== 'string' || !PROVIDER_ID_RE.test(p.id)) continue;
        if (!(PROVIDER_TYPES as readonly unknown[]).includes(p.type) || typeof p.baseUrl !== 'string') continue;
        config.providers.push({
          id: p.id,
          type: p.type as ProviderType,
          label: typeof p.label === 'string' ? p.label.slice(0, 64) : undefined,
          baseUrl: p.baseUrl,
          auth: p.auth === 'api-key' ? 'api-key' : 'bearer',
          apiKey: typeof p.apiKey === 'string' ? p.apiKey : undefined,
        });
      }
    }
    if (isRecord(data.default) && typeof data.default.provider === 'string' && typeof data.default.model === 'string') {
      config.default = { provider: data.default.provider, model: data.default.model };
    }
  }
  // Fournisseurs prédéfinis toujours présents (pour y saisir une clé)
  for (const preset of Object.values(PRESETS)) {
    if (!config.providers.some((p) => p.id === preset.id)) config.providers.push({ ...preset });
  }
  await registerKnownSecrets(config);
  return config;
}

// Jeton d'accès Cloudbox et clés API : masqués à l'identique dans tout ce qui part vers un fournisseur
async function registerKnownSecrets(config: AssistantConfig): Promise<void> {
  const token = await readFile(path.join(HOME, '.cloudbox', 'token'), 'utf8').catch(() => '');
  const envKeys = Object.entries(process.env)
    .filter(([name]) => /^CLOUDBOX_[A-Z0-9_]+_API_KEY$/.test(name))
    .map(([, value]) => value);
  setKnownSecrets([token, ...envKeys, ...config.providers.map((p) => p.apiKey)]);
}

async function saveConfig(config: AssistantConfig): Promise<void> {
  await mkdir(ASSISTANT_DIR, { recursive: true, mode: 0o700 });
  // Les fournisseurs prédéfinis sans clé ni réglage propre ne sont pas écrits
  const providers = config.providers.filter((p) => {
    const preset = PRESETS[p.id];
    return !preset || p.apiKey || p.baseUrl !== preset.baseUrl || p.auth !== preset.auth;
  });
  await writeJsonAtomic(CONFIG_FILE, { ...config, providers });
}

// Clé effective : environnement, puis fichier
export function providerKey(p: ProviderConfig): string | undefined {
  return envKey(p.id) ?? p.apiKey;
}

export function findProvider(config: AssistantConfig, id: string): ProviderConfig & { apiKey: string } {
  const p = config.providers.find((x) => x.id === id);
  if (!p) throw new HttpError(404, 'Fournisseur inconnu', 'Unknown provider');
  const apiKey = providerKey(p);
  if (!apiKey) throw new HttpError(400, `Aucune clé API pour ${p.label ?? p.id}`, `No API key for ${p.label ?? p.id}`);
  return { ...p, apiKey };
}

export function publicConfig(config: AssistantConfig) {
  return {
    allowed: !assistantForbidden(),
    enabled: config.enabled && !assistantForbidden(),
    default: config.default ?? null,
    providers: config.providers.map((p) => {
      const key = providerKey(p);
      return {
        id: p.id,
        type: p.type,
        label: p.label ?? p.id,
        baseUrl: p.baseUrl,
        auth: p.auth ?? 'bearer',
        preset: Boolean(PRESETS[p.id]),
        configured: Boolean(key),
        keyHint: key ? key.slice(-4) : null,
        keyFromEnv: Boolean(envKey(p.id)),
      };
    }),
  };
}

// Mise à jour partielle :
//   { enabled?, default?: {provider, model} | null,
//     providers?: [{ id, type?, label?, baseUrl?, auth?, apiKey?: string | null, remove?: true }] }
// apiKey absente : clé inchangée ; null : clé retirée.
export async function updateConfig(body: unknown): Promise<AssistantConfig> {
  if (!isRecord(body)) throw new HttpError(400, 'Objet JSON attendu', 'JSON object expected');
  const config = await loadConfig();
  if ('enabled' in body) {
    if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'enabled : booléen attendu', 'enabled: boolean expected');
    config.enabled = body.enabled;
  }
  if ('providers' in body) {
    if (!Array.isArray(body.providers) || body.providers.length > 16) throw new HttpError(400, 'Fournisseurs invalides', 'Invalid providers');
    for (const raw of body.providers) {
      if (!isRecord(raw)) throw new HttpError(400, 'Fournisseur invalide', 'Invalid provider');
      const id = checkProviderId(raw.id);
      const index = config.providers.findIndex((p) => p.id === id);
      if (raw.remove === true) {
        if (PRESETS[id]) {
          // Fournisseur prédéfini : on retire seulement la clé et les réglages
          config.providers[index] = { ...PRESETS[id] };
        } else if (index >= 0) {
          config.providers.splice(index, 1);
        }
        continue;
      }
      const current: ProviderConfig = index >= 0 ? config.providers[index] : { id, type: 'openai-compatible', baseUrl: '' };
      if (!PRESETS[id]) {
        // Les fournisseurs prédéfinis gardent leur type ; les autres sont des points d'accès compatibles
        // OpenAI (Azure OpenAI, passerelle d'entreprise…) ou Anthropic
        if ('type' in raw) {
          if (!(PROVIDER_TYPES as readonly unknown[]).includes(raw.type)) throw new HttpError(400, 'Type de fournisseur invalide', 'Invalid provider type');
          current.type = raw.type as ProviderType;
        }
        if ('label' in raw) {
          if (typeof raw.label !== 'string' || raw.label.trim().length > 64 || /[\u0000-\u001f\u007f]/.test(raw.label)) {
            throw new HttpError(400, 'Nom de fournisseur invalide', 'Invalid provider name');
          }
          current.label = raw.label.trim() || undefined;
        }
      }
      if ('baseUrl' in raw) current.baseUrl = checkBaseUrl(raw.baseUrl);
      if ('auth' in raw) {
        if (!(AUTH_MODES as readonly unknown[]).includes(raw.auth)) throw new HttpError(400, 'Authentification invalide', 'Invalid authentication');
        current.auth = raw.auth as AuthMode;
      }
      if ('apiKey' in raw) current.apiKey = raw.apiKey === null ? undefined : checkKey(raw.apiKey);
      if (!current.baseUrl) throw new HttpError(400, 'URL du fournisseur manquante', 'Missing provider URL');
      if (index >= 0) config.providers[index] = current;
      else config.providers.push(current);
    }
  }
  if ('default' in body) {
    if (body.default === null) {
      config.default = undefined;
    } else {
      if (!isRecord(body.default)) throw new HttpError(400, 'Modèle par défaut invalide', 'Invalid default model');
      const provider = checkProviderId(body.default.provider);
      if (!config.providers.some((p) => p.id === provider)) throw new HttpError(400, 'Fournisseur inconnu', 'Unknown provider');
      config.default = { provider, model: checkModel(body.default.model) };
    }
  }
  await saveConfig(config);
  await registerKnownSecrets(config);
  return config;
}
