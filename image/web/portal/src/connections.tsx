// Commandes de connexion (device code) : catalogue complété par les paramètres du workspace,
// panneau « Connexions » du workspace (copier, insérer dans un terminal) et aide-mémoire de l'accueil.
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, type CloudContext, type Workspace, type WorkspaceSettings } from './api';
import { serviceStatuses, type ServiceId } from './connstatus';
import { useCloudContext } from './context';
import type { DockHandle, TerminalRef } from './dock';
import { t } from './i18n';
import { Icon } from './icons';

// 'pwsh' : cmdlet PowerShell, insérable seulement dans un terminal PowerShell
type CommandShell = 'any' | 'pwsh';
type StatusKey = ServiceId | 'kubernetes' | 'github';

export interface ConnectionCommand {
  id: string;
  group: string;
  label: string;
  shell: CommandShell;
  command: string;
  // Valeurs à compléter (restées sous la forme <…> dans la commande)
  missing: string[];
  status?: StatusKey;
}

// URL SharePoint déduite d'un tenant <nom>.onmicrosoft.com
function sharepointUrl(s: WorkspaceSettings): string | undefined {
  if (s.sharepointUrl) return s.sharepointUrl;
  const m = /^([a-z0-9-]+)\.onmicrosoft\.com$/i.exec(s.tenant ?? '');
  return m ? `https://${m[1].toLowerCase()}.sharepoint.com` : undefined;
}

export function connectionCommands(s: WorkspaceSettings = {}): ConnectionCommand[] {
  const cmds: ConnectionCommand[] = [];
  const add = (c: Omit<ConnectionCommand, 'command' | 'missing'>, parts: (string | false | undefined)[]) => {
    const missing: string[] = [];
    const command = parts
      .filter((p): p is string => Boolean(p))
      .join(' ');
    for (const m of command.matchAll(/<([^>]+)>/g)) missing.push(m[1]);
    cmds.push({ ...c, command, missing });
  };
  const m = t().conn;
  const tenant = s.tenant;
  const spo = sharepointUrl(s);
  const [azure, m365, tools] = [m.groupAzure, m.groupM365, m.groupTools];

  add({ id: 'az', group: azure, label: 'Azure CLI', shell: 'any', status: 'az' },
    ['az login --use-device-code', tenant && `--tenant ${tenant}`]);
  add({ id: 'az-sub', group: azure, label: m.azSub, shell: 'any', status: 'az' },
    ['az account set --subscription', s.subscription ?? `<${m.subscriptionPlaceholder}>`]);
  add({ id: 'azd', group: azure, label: 'Azure Developer CLI', shell: 'any' },
    ['azd auth login --use-device-code', tenant && `--tenant-id ${tenant}`]);
  add({ id: 'azps', group: azure, label: 'Az PowerShell', shell: 'pwsh', status: 'azps' },
    ['Connect-AzAccount -UseDeviceAuthentication', tenant && `-Tenant ${tenant}`, s.subscription && `-Subscription ${s.subscription}`]);
  add({ id: 'aks', group: azure, label: 'AKS (Entra ID)', shell: 'any', status: 'kubernetes' },
    ['az aks get-credentials -g <rg> -n <cluster> && kubelogin convert-kubeconfig -l azurecli']);

  add({ id: 'graph', group: m365, label: 'Microsoft Graph', shell: 'pwsh', status: 'graph' },
    ['Connect-MgGraph -UseDeviceCode -Scopes "User.Read.All"', tenant && `-TenantId ${tenant}`]);
  add({ id: 'exo', group: m365, label: 'Exchange Online', shell: 'pwsh', status: 'exo' },
    ['Connect-ExchangeOnline -Device']);
  add({ id: 'teams', group: m365, label: 'Microsoft Teams', shell: 'pwsh', status: 'teams' },
    ['Connect-MicrosoftTeams -UseDeviceAuthentication', tenant && `-TenantId ${tenant}`]);
  add({ id: 'pnp', group: m365, label: 'PnP PowerShell', shell: 'pwsh', status: 'pnp' },
    ['Connect-PnPOnline -Url', spo ?? 'https://<tenant>.sharepoint.com', '-DeviceLogin -ClientId', s.clientId ?? '<app-id>',
      tenant && `-Tenant ${tenant}`]);
  add({ id: 'm365', group: m365, label: 'CLI for Microsoft 365', shell: 'any', status: 'm365' },
    ['m365 login --authType deviceCode', tenant && `--tenant ${tenant}`, s.clientId && `--appId ${s.clientId}`]);

  add({ id: 'gh', group: tools, label: 'GitHub CLI', shell: 'any', status: 'github' }, ['gh auth login']);
  return cmds;
}

type Status = { state: 'on' | 'off' | 'warn'; text: string; title?: string };

function statusOf(key: StatusKey | undefined, ctx: CloudContext | null, s: WorkspaceSettings): Status | null {
  if (!key || !ctx) return null;
  const c = t().context;
  if (key === 'kubernetes') {
    return ctx.kubernetes ? { state: 'on', text: ctx.kubernetes.context } : { state: 'off', text: c.noContext };
  }
  if (key === 'github') {
    return ctx.github
      ? { state: 'on', text: ctx.github.user || ctx.github.host, title: ctx.github.host }
      : { state: 'off', text: c.notConnected };
  }
  const st = serviceStatuses(ctx, s).find((x) => x.id === key);
  return st ? { state: st.state, text: st.text, title: st.detail.join('\n') } : null;
}

export function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const m = t().conn;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
    window.setTimeout(() => setState('idle'), 1500);
  };
  const label = state === 'copied' ? m.copied : state === 'failed' ? m.copyFailed : m.copy;
  return <button type="button" class="copy" onClick={copy} aria-label={m.copyLabel(text)}>{label}</button>;
}

function CommandRow({ cmd, status, target, onInsert }: {
  cmd: ConnectionCommand;
  status: Status | null;
  target: TerminalRef | null;
  onInsert: (cmd: ConnectionCommand, target: TerminalRef) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const m = t().conn;
  const insertTitle = target ? m.insertInto(target.title) : cmd.shell === 'pwsh' ? m.needPwsh : m.needTerminal;
  return (
    <li class="conn-item" data-cmd={cmd.id}>
      <div class="conn-head">
        <span class="conn-label">{cmd.label}</span>
        {cmd.shell === 'pwsh' && <span class="conn-shell" title={m.cmdlet}>PS</span>}
        {status && <span class={`conn-status ${status.state}`} title={status.title}>{status.text}</span>}
      </div>
      <code class="conn-cmd">{cmd.command}</code>
      <div class="conn-actions">
        {cmd.missing.length > 0 && <span class="conn-missing">{m.toComplete} {cmd.missing.join(', ')}</span>}
        <CopyButton text={cmd.command} />
        <button type="button" class="copy insert" disabled={!target || busy} title={insertTitle}
          aria-label={m.insertLabel(cmd.label)}
          onClick={async () => {
            if (!target) return;
            setBusy(true);
            await onInsert(cmd, target);
            setBusy(false);
          }}>
          ▶ {target ? target.title : m.insert}
        </button>
      </div>
    </li>
  );
}

export function ConnectionsDrawer({ ws, dock, onClose, onEditSettings }: {
  ws: Workspace;
  dock: DockHandle | null;
  onClose: () => void;
  onEditSettings: () => void;
}) {
  const ctx = useCloudContext(ws.id);
  const [filter, setFilter] = useState('');
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const m = t().conn;
  const settings = ws.settings ?? {};
  const cloud = ctx && ctx !== 'error' ? ctx : null;

  useEffect(() => filterRef.current?.focus(), []);

  const q = filter.trim().toLowerCase();
  const cmds = connectionCommands(settings).filter(
    (c) => !q || c.label.toLowerCase().includes(q) || c.command.toLowerCase().includes(q) || c.group.toLowerCase().includes(q),
  );
  const groups = [...new Set(cmds.map((c) => c.group))];
  const configured = Boolean(settings.tenant || settings.subscription || settings.sharepointUrl || settings.clientId);

  const insert = async (cmd: ConnectionCommand, target: TerminalRef) => {
    try {
      await api.sendInput(ws.id, target.session, cmd.command);
      setMessage({ text: m.inserted(target.title) });
      dock?.focusPanel(target.panelId);
    } catch (err) {
      setMessage({ text: (err as Error).message, error: true });
    }
  };

  return (
    <aside class="conn-drawer" aria-label={t().common.connections}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div class="conn-top">
        <h2><Icon name="book" size={18} /> {t().common.connections}</h2>
        <button type="button" class="dialog-close" aria-label={m.closePanel} title={m.closeEsc}
          onClick={onClose}><Icon name="close" size={18} /></button>
      </div>
      <input ref={filterRef} class="conn-filter" type="search" placeholder={m.filter} value={filter}
        onInput={(e) => setFilter(e.currentTarget.value)} aria-label={m.filterLabel} />
      <p class="conn-settings muted">
        {configured
          ? <>{m.completedWith}{settings.tenant && <> ({m.tenant} <code>{settings.tenant}</code>)</>}.</>
          : <>{m.fillIn}</>}
        {' '}<button type="button" class="link-button" onClick={onEditSettings}>{t().common.settings}</button>
      </p>
      {cloud && (
        <p class={`conn-identities ${cloud.identities}`}>
          <Icon name={cloud.identities === 'isolated' ? 'lock' : 'share'} size={15} />
          {cloud.identities === 'isolated' ? m.identitiesIsolated : m.identitiesShared}
        </p>
      )}
      {message && <p class={`conn-message${message.error ? ' error' : ''}`} role="status">{message.text}</p>}
      <div class="conn-list">
        {groups.map((g) => (
          <section key={g}>
            <h3 class="conn-group">{g}</h3>
            <ul>
              {cmds.filter((c) => c.group === g).map((c) => (
                <CommandRow key={c.id} cmd={c} status={statusOf(c.status, cloud, settings)}
                  target={dock?.terminalFor(c.shell === 'pwsh' ? 'pwsh' : 'any') ?? null} onInsert={insert} />
              ))}
            </ul>
          </section>
        ))}
        {cmds.length === 0 && <p class="muted">{m.none}</p>}
      </div>
      <p class="conn-foot muted">{m.foot}</p>
    </aside>
  );
}
