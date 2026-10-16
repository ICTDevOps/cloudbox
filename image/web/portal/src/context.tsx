// Barre de contexte : ce que les outils utilisent réellement (lu par cloudbox-api dans les fichiers
// de configuration et dans les sessions publiées par chaque terminal PowerShell), jamais une valeur
// déclarée. Groupes Azure, Microsoft 365 et Kubernetes, une pastille par service. Contexte commun
// (accueil) ou d'un workspace (ses connexions isolées). Une interrogation toutes les 15 secondes par
// contexte, partagée par tous les composants abonnés (barres, aide-mémoire, assistant), tant qu'il y en a un.
import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { api, type CloudContext, type WorkspaceSettings } from './api';
import { serviceStatuses, type ServiceId, type ServiceStatus } from './connstatus';
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

// Pastille d'un service. Dans un workspace, c'est un bouton : non connecté, il saisit la commande de
// connexion dans un terminal (onConnect) ; sinon il ouvre l'aide-mémoire (détail et commandes)
function ServiceItem({ st, showValue, onOpen, onConnect }: {
  st: ServiceStatus;
  showValue: boolean;
  onOpen?: () => void;
  onConnect?: (id: ServiceId) => void;
}) {
  const m = t().context;
  const count = st.terminals.length > 1 ? ` ×${st.terminals.length}` : '';
  const content = (
    <>
      <span class="svc-dot" aria-hidden="true" />
      <span class="svc-label">{st.label}</span>
      {showValue && st.value && <span class="svc-value">{st.value}</span>}
      {count && <span class="svc-count">{count}</span>}
      <span class="sr-only"> ({st.state === 'off' ? m.notConnected : st.text})</span>
    </>
  );
  const action = st.state === 'off' && onConnect ? () => onConnect(st.id) : onOpen;
  const hint = st.state === 'off' && onConnect ? m.clickConnect : onOpen ? m.openSheet : '';
  const title = [...st.detail, hint].filter(Boolean).join('\n');
  return action
    ? <button type="button" class={`svc ${st.state}`} data-svc={st.id} title={title} onClick={action}>{content}</button>
    : <span class={`svc ${st.state}`} data-svc={st.id} title={title}>{content}</span>;
}

// Groupe de services, nom en infobulle : l'icône suffit à l'écran, la place va aux services
function Group({ name, icon, children }: { name: string; icon: IconName; children: ComponentChildren }) {
  return <span class="ctx-group" title={name}><Icon name={icon} size={15} /><span class="sr-only">{name}</span>{children}</span>;
}

// Contexte Kubernetes (pas de connexion en un clic : le cluster se choisit) : ouvre l'aide-mémoire
function Kube({ class: cls, title, onOpen, children }: { class: string; title: string; onOpen?: () => void; children: ComponentChildren }) {
  const full = [title, onOpen && t().context.openSheet].filter(Boolean).join('\n');
  return onOpen
    ? <button type="button" class={cls} data-svc="kube" title={full} onClick={onOpen}>{children}</button>
    : <span class={cls} data-svc="kube" title={full}>{children}</span>;
}

// wsId : contexte des terminaux de ce workspace (connexions isolées ou partagées, sessions de chaque
// terminal PowerShell) ; sans : contexte commun. onOpen : ouvre l'aide-mémoire des connexions ; onConnect :
// saisit la commande de connexion d'un service non connecté.
export function ContextBar({ wsId, settings, onOpen, onConnect }: {
  wsId?: string;
  settings?: WorkspaceSettings;
  onOpen?: () => void;
  onConnect?: (id: ServiceId) => void;
}) {
  const ctx = useCloudContext(wsId);
  const m = t().context;
  if (ctx === null) return <div class="context-bar muted">{m.loading}</div>;
  if (ctx === 'error') return <div class="context-bar muted">{m.unavailable}</div>;
  const sep = document.documentElement.lang === 'fr' ? ' : ' : ': ';
  const services = serviceStatuses(ctx, settings, Boolean(wsId));
  // Az PS : abonnement affiché seulement s'il diffère de celui d'az (sinon en infobulle)
  const azValue = services.find((s) => s.id === 'az')?.value;
  const showValue = (st: ServiceStatus) => st.id === 'az' || (st.id === 'azps' && st.value !== azValue);
  const group = (g: 'azure' | 'm365') =>
    services.filter((s) => s.group === g).map((s) => <ServiceItem key={s.id} st={s} showValue={showValue(s)} onOpen={onOpen} onConnect={onConnect} />);
  return (
    <div class="context-bar" aria-label={m.label}>
      <Group name="Azure" icon="azure">{group('azure')}</Group>
      <Group name="Microsoft 365" icon="m365">{group('m365')}</Group>
      <Group name="Kubernetes" icon="kubernetes">
        {ctx.kubernetes ? (
          <Kube class="svc on" onOpen={onOpen} title={`${m.kubeContext}${sep}${ctx.kubernetes.context}\n${m.namespace}${sep}${ctx.kubernetes.namespace}`}>
            <span class="svc-label">{ctx.kubernetes.context}</span>
            <span class="svc-value">{ctx.kubernetes.namespace}</span>
          </Kube>
        ) : (
          <Kube class="svc off" onOpen={onOpen} title={m.noContext}><span class="svc-dot" aria-hidden="true" /> {m.noContext}</Kube>
        )}
      </Group>
      {wsId && (ctx.identities === 'isolated' ? (
        <span class="ctx-mode chip-isolated" title={`${m.isolated}\n${m.isolatedTitle}`} aria-label={m.isolated}>
          <Icon name="lock" size={15} />
        </span>
      ) : (
        <span class="chip chip-warn" title={m.sharedTitle}>
          <Icon name="share" size={15} /> {m.shared}
        </span>
      ))}
    </div>
  );
}
