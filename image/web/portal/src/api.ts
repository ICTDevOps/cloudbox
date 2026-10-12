// Accès à cloudbox-api. Les écritures sont en JSON : condition imposée par l'API (protection CSRF).

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

export interface Workspace extends WorkspaceSummary {
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
  sharedAcrossWorkspaces: boolean;
}

export interface ToolVersion {
  category: string;
  name: string;
  command: string;
  version: string;
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', cache: 'no-store' };
  if (method !== 'GET') {
    init.headers = { 'Content-Type': 'application/json' };
    if (body !== undefined) init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  if (response.status === 401) {
    // Session expirée : la page de connexion s'affiche au rechargement
    window.location.reload();
    throw new ApiError(401, 'Session expirée');
  }
  if (!response.ok) {
    let message = `Erreur ${response.status}`;
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
  updateWorkspace: (id: string, data: Partial<Pick<Workspace, 'name' | 'env' | 'layout'>>) =>
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
  versions: async (): Promise<{ generated: string; arch: string; tools: ToolVersion[] }> => {
    const response = await fetch('/versions.json', { cache: 'no-cache', credentials: 'same-origin' });
    if (!response.ok) throw new ApiError(response.status, 'Versions indisponibles');
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
