// Barre de contexte : ce que les outils utilisent réellement (lu par cloudbox-api dans les fichiers
// de configuration), jamais une valeur déclarée. Une seule interrogation toutes les 15 secondes,
// partagée par tous les composants abonnés (barres, panneau Connexions), tant qu'il y en a un.
import { useEffect, useState } from 'preact/hooks';
import { api, type AzureContext, type CloudContext } from './api';
import { t } from './i18n';

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
  const m = t().context;
  if (!ctx) {
    return (
      <span class="chip chip-off" title={hint}>
        <span class="chip-label">{label}</span> {m.notConnected}
      </span>
    );
  }
  // Séparateur : espace avant les deux-points en français
  const sep = document.documentElement.lang === 'fr' ? ' : ' : ': ';
  const title = [`${m.subscription}${sep}${ctx.subscription} (${ctx.subscriptionId})`, `${m.tenant}${sep}${ctx.tenantId}`,
    `${m.account}${sep}${ctx.user}`, ctx.cloud && `${m.cloud}${sep}${ctx.cloud}`, hint].filter(Boolean).join('\n');
  return (
    <span class="chip" title={title}>
      <span class="chip-label">{label}</span> {ctx.subscription}
      {ctx.user && <span class="chip-muted"> · {ctx.user}</span>}
    </span>
  );
}

export function ContextBar({ showShared = false }: { showShared?: boolean }) {
  const ctx = useCloudContext();
  const m = t().context;
  if (ctx === null) return <div class="context-bar muted">{m.loading}</div>;
  if (ctx === 'error') return <div class="context-bar muted">{m.unavailable}</div>;
  const sep = document.documentElement.lang === 'fr' ? ' : ' : ': ';
  return (
    <div class="context-bar" aria-label={m.label}>
      <AzureChip label="az" ctx={ctx.azureCli} hint={m.hintAz} />
      <AzureChip label="Az PS" ctx={ctx.azPowerShell} hint={m.hintAzPs} />
      {ctx.kubernetes ? (
        <span class="chip" title={`${m.kubeContext}${sep}${ctx.kubernetes.context}\n${m.namespace}${sep}${ctx.kubernetes.namespace}`}>
          <span class="chip-label">⎈</span> {ctx.kubernetes.context}
          <span class="chip-muted"> · {ctx.kubernetes.namespace}</span>
        </span>
      ) : (
        <span class="chip chip-off"><span class="chip-label">⎈</span> {m.noContext}</span>
      )}
      {showShared && ctx.sharedAcrossWorkspaces && (
        <span class="chip chip-warn" title={m.sharedTitle}>
          {m.shared}
        </span>
      )}
    </div>
  );
}
