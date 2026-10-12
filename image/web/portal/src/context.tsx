// Barre de contexte : ce que les outils utilisent réellement (lu par cloudbox-api dans les fichiers
// de configuration), jamais une valeur déclarée. Rafraîchie toutes les 15 secondes.
import { useEffect, useState } from 'preact/hooks';
import { api, type AzureContext, type CloudContext } from './api';

const REFRESH_MS = 15_000;

function useCloudContext(): CloudContext | null | 'error' {
  const [ctx, setCtx] = useState<CloudContext | null | 'error'>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .context()
        .then((c) => alive && setCtx(c))
        .catch(() => alive && setCtx('error'));
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
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
