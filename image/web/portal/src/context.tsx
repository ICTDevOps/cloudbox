// Barre de contexte : ce que les outils utilisent réellement (lu par cloudbox-api dans les fichiers
// de configuration), jamais une valeur déclarée. Une seule interrogation toutes les 15 secondes,
// partagée par tous les composants abonnés (barres, panneau Connexions), tant qu'il y en a un.
import { useEffect, useState } from 'preact/hooks';
import { api, type AzureContext, type CloudContext } from './api';

const REFRESH_MS = 15_000;

type ContextState = CloudContext | null | 'error';
let current: ContextState = null;
let timer = 0;
const listeners = new Set<(c: ContextState) => void>();

function load(): void {
  api
    .context()
    .then((c) => (current = c))
    .catch(() => (current = 'error'))
    .finally(() => listeners.forEach((l) => l(current)));
}

export function refreshCloudContext(): void {
  if (listeners.size) load();
}

export function useCloudContext(): ContextState {
  const [ctx, setCtx] = useState<ContextState>(current);
  useEffect(() => {
    listeners.add(setCtx);
    if (listeners.size === 1) {
      load();
      timer = window.setInterval(load, REFRESH_MS);
    }
    return () => {
      listeners.delete(setCtx);
      if (!listeners.size) window.clearInterval(timer);
    };
  }, []);
  return ctx;
}

function AzureChip({ label, ctx, hint }: { label: string; ctx: AzureContext | null; hint: string }) {
  if (!ctx) {
    return (
      <span class="chip chip-off" title={hint}>
        <span class="chip-label">{label}</span> non connecté
      </span>
    );
  }
  const title = [`Abonnement : ${ctx.subscription} (${ctx.subscriptionId})`, `Tenant : ${ctx.tenantId}`,
    `Compte : ${ctx.user}`, ctx.cloud && `Cloud : ${ctx.cloud}`, hint].filter(Boolean).join('\n');
  return (
    <span class="chip" title={title}>
      <span class="chip-label">{label}</span> {ctx.subscription}
      {ctx.user && <span class="chip-muted"> · {ctx.user}</span>}
    </span>
  );
}

export function ContextBar({ showShared = false }: { showShared?: boolean }) {
  const ctx = useCloudContext();
  if (ctx === null) return <div class="context-bar muted">Contexte…</div>;
  if (ctx === 'error') return <div class="context-bar muted">Contexte indisponible</div>;
  return (
    <div class="context-bar" aria-label="Contexte cloud réel">
      <AzureChip label="az" ctx={ctx.azureCli} hint="Azure CLI : abonnement par défaut (az account show)" />
      <AzureChip label="Az PS" ctx={ctx.azPowerShell}
        hint="Az PowerShell : contexte enregistré (Get-AzContext), distinct de celui d'Azure CLI" />
      {ctx.kubernetes ? (
        <span class="chip" title={`Contexte kubectl : ${ctx.kubernetes.context}\nNamespace : ${ctx.kubernetes.namespace}`}>
          <span class="chip-label">⎈</span> {ctx.kubernetes.context}
          <span class="chip-muted"> · {ctx.kubernetes.namespace}</span>
        </span>
      ) : (
        <span class="chip chip-off"><span class="chip-label">⎈</span> aucun contexte</span>
      )}
      {showShared && ctx.sharedAcrossWorkspaces && (
        <span class="chip chip-warn" title="Les connexions az, Az PowerShell et kubectl ne sont pas encore isolées par workspace : tous les workspaces utilisent ce même contexte.">
          partagé entre workspaces
        </span>
      )}
    </div>
  );
}
