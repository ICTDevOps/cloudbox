// Accès à cloudbox-api. Les écritures sont en JSON : condition imposée par l'API (protection CSRF).
// Accept-Language : l'API répond dans la langue de l'interface.
import { getLang, t } from './i18n';

export type Env = 'dev' | 'acc' | 'prd';
export const ENVS: readonly Env[] = ['dev', 'acc', 'prd'];
export const ENV_LABELS: Record<Env, string> = { dev: 'DEV', acc: 'ACC', prd: 'PRD' };

export interface WorkspaceSummary {
  id: string;
  name: string;
  env: Env;
  folder: string;
  updated: string;
}

// Paramètres de connexion propres au workspace (validés strictement par cloudbox-api)
export interface WorkspaceSettings {
  tenant?: string;
  subscription?: string;
  sharepointUrl?: string;
  clientId?: string;
}

export interface Workspace extends WorkspaceSummary {
  settings?: WorkspaceSettings;
  layout: object | null;
  sessions: string[];
}

export interface AzureContext {
  subscription: string;
  subscriptionId: string;
  tenantId: string;
  user: string;
  cloud: string;
}

export interface CloudContext {
  azureCli: AzureContext | null;
  azPowerShell: AzureContext | null;
  kubernetes: { context: string; namespace: string } | null;
  github: { host: string; user: string } | null;
  sharedAcrossWorkspaces: boolean;
}

export interface ToolVersion {
  category: string;
  name: string;
  command: string;
  version: string;
}

// --- Assistant IA ---

export interface ProviderInfo {
  id: string;
  type: 'openai-compatible' | 'anthropic';
  label: string;
  baseUrl: string;
  auth: 'bearer' | 'api-key';
  preset: boolean;
  configured: boolean;
  keyHint: string | null;
  keyFromEnv: boolean;
}

export interface AssistantConfig {
  allowed: boolean;
  enabled: boolean;
  default: { provider: string; model: string } | null;
  providers: ProviderInfo[];
}

export interface ProviderUpdate {
  id: string;
  type?: ProviderInfo['type'];
  label?: string;
  baseUrl?: string;
  auth?: ProviderInfo['auth'];
  apiKey?: string | null;
  remove?: true;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type ChatMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; callId: string; name: string; content: string };

export interface Proposal {
  id: string;
  callId: string;
  command: string;
  shell: 'pwsh' | 'bash';
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  created: string;
  decided?: string;
  executed?: string;
  session?: string;
  note?: string;
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

export interface ConversationSummary {
  id: string;
  title: string;
  updated: string;
  pending: number;
}

export interface AssistantState {
  conversations: ConversationSummary[];
  busy: boolean;
  agentsFile: string;
  default: { provider: string; model: string } | null;
}

export type AssistantEvent =
  | { event: 'text'; data: { text: string } }
  | { event: 'tool'; data: { name: string; state: 'start' | 'done' } }
  | { event: 'proposal'; data: { proposal: Proposal } }
  | { event: 'executed'; data: { id: string; command: string; session: string; output: string; finished: boolean } }
  | { event: 'error'; data: { message: string } }
  | { event: 'done'; data: { reason: string } };

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Requête dont la réponse est un flux SSE (POST : EventSource ne convient pas). Une erreur avant le
// flux (validation, 409…) arrive en JSON, comme pour les autres requêtes.
async function streamRequest(path: string, body: unknown, onEvent: (e: AssistantEvent) => void, signal?: AbortSignal): Promise<void> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Accept-Language': getLang(), 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  });
  if (response.status === 401) {
    window.location.reload();
    throw new ApiError(401, t().common.sessionExpired);
  }
  if (!response.ok || !response.body) {
    let message = t().common.error(response.status);
    try {
      message = ((await response.json()) as { error?: string }).error ?? message;
    } catch {
      // réponse sans JSON
    }
    throw new ApiError(response.status, message);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let event = '';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (!event || !data) continue;
      try {
        onEvent({ event, data: JSON.parse(data) } as AssistantEvent);
      } catch {
        // événement illisible : ignoré
      }
    }
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Accept-Language': getLang() };
  const init: RequestInit = { method, credentials: 'same-origin', cache: 'no-store', headers };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    if (body !== undefined) init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  if (response.status === 401) {
    // Session expirée : la page de connexion s'affiche au rechargement
    window.location.reload();
    throw new ApiError(401, t().common.sessionExpired);
  }
  if (!response.ok) {
    let message = t().common.error(response.status);
    try {
      message = ((await response.json()) as { error?: string }).error ?? message;
    } catch {
      // réponse sans JSON
    }
    throw new ApiError(response.status, message);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export const api = {
  context: () => request<CloudContext>('GET', '/api/context'),
  listWorkspaces: () => request<WorkspaceSummary[]>('GET', '/api/workspaces'),
  getWorkspace: (id: string) => request<Workspace>('GET', `/api/workspaces/${id}`),
  createWorkspace: (data: { id: string; name: string; env: Env; folder?: string }) =>
    request<Workspace>('POST', '/api/workspaces', data),
  updateWorkspace: (id: string, data: Partial<Pick<Workspace, 'name' | 'env' | 'layout' | 'settings'>>) =>
    request<WorkspaceSummary>('PUT', `/api/workspaces/${id}`, data),
  // Numéro de panneau terminal attribué par le serveur (jamais réutilisé, même avec plusieurs onglets)
  allocatePanel: async (id: string) => (await request<{ n: number }>('POST', `/api/workspaces/${id}/panels`)).n,
  // Envoi de la disposition à la fermeture de la page (keepalive : la requête survit au déchargement)
  saveLayoutOnUnload: (id: string, layout: object) =>
    fetch(`/api/workspaces/${id}`, {
      method: 'PUT',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout }),
    }).catch(() => undefined),
  deleteWorkspace: (id: string) => request<void>('DELETE', `/api/workspaces/${id}`),
  closeSession: (id: string, session: string) =>
    request<void>('DELETE', `/api/workspaces/${id}/sessions/${session}`),
  // Saisie dans un terminal, sans Entrée
  sendInput: (id: string, session: string, text: string) =>
    request<void>('POST', `/api/workspaces/${id}/sessions/${session}/input`, { text }),
  assistantConfig: () => request<AssistantConfig>('GET', '/api/assistant/config'),
  updateAssistantConfig: (data: { enabled?: boolean; default?: { provider: string; model: string } | null; providers?: ProviderUpdate[] }) =>
    request<AssistantConfig>('PUT', '/api/assistant/config', data),
  assistantModels: async (provider: string) =>
    (await request<{ models: string[] }>('GET', `/api/assistant/models?provider=${encodeURIComponent(provider)}`)).models,
  assistantState: (ws: string) => request<AssistantState>('GET', `/api/workspaces/${ws}/assistant`),
  newConversation: (ws: string) => request<Conversation>('POST', `/api/workspaces/${ws}/assistant/conversations`),
  getConversation: (ws: string, conv: string) => request<Conversation>('GET', `/api/workspaces/${ws}/assistant/conversations/${conv}`),
  deleteConversation: (ws: string, conv: string) => request<void>('DELETE', `/api/workspaces/${ws}/assistant/conversations/${conv}`),
  sendMessage: (ws: string, conv: string, body: { text: string; provider?: string; model?: string; activeSession?: string },
    onEvent: (e: AssistantEvent) => void, signal?: AbortSignal) =>
    streamRequest(`/api/workspaces/${ws}/assistant/conversations/${conv}/messages`, body, onEvent, signal),
  approveProposal: (ws: string, conv: string, id: string, body: { session: string; command: string; confirmPrd?: boolean },
    onEvent: (e: AssistantEvent) => void, signal?: AbortSignal) =>
    streamRequest(`/api/workspaces/${ws}/assistant/conversations/${conv}/proposals/${id}/approve`, body, onEvent, signal),
  rejectProposal: (ws: string, conv: string, id: string, body: { reason?: string; activeSession?: string },
    onEvent: (e: AssistantEvent) => void, signal?: AbortSignal) =>
    streamRequest(`/api/workspaces/${ws}/assistant/conversations/${conv}/proposals/${id}/reject`, body, onEvent, signal),
  stopAssistant: (ws: string) => request<void>('POST', `/api/workspaces/${ws}/assistant/stop`),
  assistantMemory: async (ws: string) => (await request<{ text: string }>('GET', `/api/workspaces/${ws}/assistant/memory`)).text,
  saveAssistantMemory: (ws: string, text: string) => request<void>('PUT', `/api/workspaces/${ws}/assistant/memory`, { text }),
  versions: async (): Promise<{ generated: string; arch: string; tools: ToolVersion[] }> => {
    const response = await fetch('/versions.json', { cache: 'no-cache', credentials: 'same-origin' });
    if (!response.ok) throw new ApiError(response.status, t().home.versionsUnavailable);
    return response.json();
  },
};

// Identifiant de workspace proposé à partir du nom : minuscules, chiffres, tirets
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
}

export const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
