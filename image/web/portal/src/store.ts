// Liste des workspaces partagée par la barre latérale et l'accueil.
import { useEffect, useState } from 'preact/hooks';
import { api, type WorkspaceSummary } from './api';

let list: WorkspaceSummary[] | null = null;
let error = '';
const listeners = new Set<() => void>();

export const workspaceStore = {
  async reload(): Promise<void> {
    try {
      list = await api.listWorkspaces();
      error = '';
    } catch (err) {
      error = (err as Error).message;
    }
    listeners.forEach((l) => l());
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useWorkspaces(): { list: WorkspaceSummary[] | null; error: string } {
  const [, setVersion] = useState(0);
  useEffect(() => workspaceStore.subscribe(() => setVersion((v) => v + 1)), []);
  return { list, error };
}
