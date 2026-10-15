// Barre de contexte : ce que les outils utilisent réellement (lu par cloudbox-api dans les fichiers
// de configuration), jamais une valeur déclarée. Contexte commun (accueil) ou d'un workspace (ses
// connexions isolées). Une interrogation toutes les 15 secondes par contexte, partagée par tous les
// composants abonnés (barres, aide-mémoire, assistant), tant qu'il y en a un.
import { useEffect, useState } from 'preact/hooks';
import { api, type AzureContext, type CloudContext, type ContextTool } from './api';
import { t } from './i18n';
import { Icon, type IconName } from './icons';

const REFRESH_MS = 15_000;

type ContextState = CloudContext | null | 'error';

// Clé : identifiant du workspace, ou « » pour le contexte commun
interface Entry {
  current: ContextState;
  timer: number;
  listeners: Set<(c: ContextState) => void>;
}
const entries = new Map<string, Entry>();

function entry(key: string): Entry {
  let e = entries.get(key);
  if (!e) {
    e = { current: null, timer: 0, listeners: new Set() };
    entries.set(key, e);
  }
  return e;
}

function load(key: string): void {
  const e = entry(key);
  (key ? api.workspaceContext(key) : api.context())
    .then((c) => (e.current = c))
    .catch(() => (e.current = 'error'))
    .finally(() => e.listeners.forEach((l) => l(e.current)));
}

export function refreshCloudContext(): void {
  for (const [key, e] of entries) if (e.listeners.size) load(key);
}

export function useCloudContext(wsId = ''): ContextState {
  const [ctx, setCtx] = useState<ContextState>(entry(wsId).current);
  useEffect(() => {
    const e = entry(wsId);
    setCtx(e.current);
    e.listeners.add(setCtx);
    if (e.listeners.size === 1) {
      load(wsId);
      e.timer = window.setInterval(() => load(wsId), REFRESH_MS);
    }
    return () => {
      e.listeners.delete(setCtx);
      if (!e.listeners.size) window.clearInterval(e.timer);
    };
  }, [wsId]);
  return ctx;
}

function AzureChip({ label, icon, ctx, hint, shared }: { label: string; icon: IconName; ctx: AzureContext | null; hint: string; shared: boolean }) {
  const m = t().context;
  const sharedMark = shared && <Icon name="share" size={13} class="chip-shared" />;
  const sharedHint = shared ? m.toolShared : '';
  if (!ctx) {
    return (
      <span class="chip chip-off" title={[hint, sharedHint].filter(Boolean).join('\n')}>
        <Icon name={icon} size={15} /><span class="chip-label">{label}</span> {m.notConnected}{sharedMark}
      </span>
    );
  }
  // Séparateur : espace avant les deux-points en français
  const sep = document.documentElement.lang === 'fr' ? ' : ' : ': ';
  const title = [`${m.subscription}${sep}${ctx.subscription} (${ctx.subscriptionId})`, `${m.tenant}${sep}${ctx.tenantId}`,
    `${m.account}${sep}${ctx.user}`, ctx.cloud && `${m.cloud}${sep}${ctx.cloud}`, hint, sharedHint].filter(Boolean).join('\n');
  return (
    <span class="chip" title={title}>
      <Icon name={icon} size={15} /><span class="chip-label">{label}</span> {ctx.subscription}
      {ctx.user && <span class="chip-muted"> · {ctx.user}</span>}{sharedMark}
    </span>
  );
}

// wsId : contexte des terminaux de ce workspace (connexions isolées ou partagées) ; sans : contexte commun
export function ContextBar({ wsId }: { wsId?: string }) {
  const ctx = useCloudContext(wsId);
  const m = t().context;
  if (ctx === null) return <div class="context-bar muted">{m.loading}</div>;
  if (ctx === 'error') return <div class="context-bar muted">{m.unavailable}</div>;
  const sep = document.documentElement.lang === 'fr' ? ' : ' : ': ';
  // Outil partagé signalé seulement dans un workspace isolé (en mode partagé, la puce dit tout)
  const marked = (tool: ContextTool) => Boolean(wsId) && ctx.identities === 'isolated' && ctx.shared.includes(tool);
  return (
    <div class="context-bar" aria-label={m.label}>
      <AzureChip label="az" icon="azure" ctx={ctx.azureCli} hint={m.hintAz} shared={marked('azureCli')} />
      <AzureChip label="Az PS" icon="pwsh" ctx={ctx.azPowerShell} hint={m.hintAzPs} shared={marked('azPowerShell')} />
      {ctx.kubernetes ? (
        <span class="chip" title={`${m.kubeContext}${sep}${ctx.kubernetes.context}\n${m.namespace}${sep}${ctx.kubernetes.namespace}`}>
          <Icon name="kubernetes" size={15} /> {ctx.kubernetes.context}
          <span class="chip-muted"> · {ctx.kubernetes.namespace}</span>
        </span>
      ) : (
        <span class="chip chip-off"><span class="chip-dot" aria-hidden="true" /> {m.noContext}</span>
      )}
      {wsId && (ctx.identities === 'isolated' ? (
        <span class="chip chip-isolated" title={m.isolatedTitle}>
          <Icon name="lock" size={15} /> {m.isolated}
        </span>
      ) : (
        <span class="chip chip-warn" title={m.sharedTitle}>
          <Icon name="share" size={15} /> {m.shared}
        </span>
      ))}
    </div>
  );
}
