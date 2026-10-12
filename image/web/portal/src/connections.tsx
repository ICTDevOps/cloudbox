// Commandes de connexion (device code) : catalogue complété par les paramètres du workspace,
// panneau « Connexions » du workspace (copier, insérer dans un terminal) et aide-mémoire de l'accueil.
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, type CloudContext, type Workspace, type WorkspaceSettings } from './api';
import { useCloudContext } from './context';
import type { DockHandle, TerminalRef } from './dock';

// 'pwsh' : cmdlet PowerShell, insérable seulement dans un terminal PowerShell
type CommandShell = 'any' | 'pwsh';
type StatusKey = 'azureCli' | 'azPowerShell' | 'kubernetes' | 'github' | 'session';

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

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const t = s.tenant;
  const spo = sharepointUrl(s);

  add({ id: 'az', group: 'Azure', label: 'Azure CLI', shell: 'any', status: 'azureCli' },
    ['az login --use-device-code', t && `--tenant ${t}`]);
  add({ id: 'az-sub', group: 'Azure', label: 'Azure CLI : abonnement', shell: 'any', status: 'azureCli' },
    ['az account set --subscription', s.subscription ?? '<abonnement>']);
  add({ id: 'azd', group: 'Azure', label: 'Azure Developer CLI', shell: 'any' },
    ['azd auth login --use-device-code', t && `--tenant-id ${t}`]);
  add({ id: 'azps', group: 'Azure', label: 'Az PowerShell', shell: 'pwsh', status: 'azPowerShell' },
    ['Connect-AzAccount -UseDeviceAuthentication', t && `-Tenant ${t}`, s.subscription && `-Subscription ${s.subscription}`]);
  add({ id: 'aks', group: 'Azure', label: 'AKS (Entra ID)', shell: 'any', status: 'kubernetes' },
    ['az aks get-credentials -g <rg> -n <cluster> && kubelogin convert-kubeconfig -l azurecli']);

  add({ id: 'graph', group: 'Microsoft 365', label: 'Microsoft Graph', shell: 'pwsh', status: 'session' },
    ['Connect-MgGraph -UseDeviceCode -Scopes "User.Read.All"', t && `-TenantId ${t}`]);
  add({ id: 'exo', group: 'Microsoft 365', label: 'Exchange Online', shell: 'pwsh', status: 'session' },
    ['Connect-ExchangeOnline -Device']);
  add({ id: 'teams', group: 'Microsoft 365', label: 'Microsoft Teams', shell: 'pwsh', status: 'session' },
    ['Connect-MicrosoftTeams -UseDeviceAuthentication', t && `-TenantId ${t}`]);
  add({ id: 'pnp', group: 'Microsoft 365', label: 'PnP PowerShell', shell: 'pwsh', status: 'session' },
    ['Connect-PnPOnline -Url', spo ?? 'https://<tenant>.sharepoint.com', '-DeviceLogin -ClientId', s.clientId ?? '<app-id>',
      t && `-Tenant ${t}`]);
  add({ id: 'm365', group: 'Microsoft 365', label: 'CLI for Microsoft 365', shell: 'any' },
    ['m365 login --authType deviceCode', t && `--tenant ${t}`, s.clientId && `--appId ${s.clientId}`]);

  add({ id: 'gh', group: 'Outils', label: 'GitHub CLI', shell: 'any', status: 'github' }, ['gh auth login']);
  return cmds;
}

type Status = { state: 'on' | 'off' | 'warn' | 'info'; text: string; title?: string };

function statusOf(key: StatusKey | undefined, ctx: CloudContext | null, s: WorkspaceSettings): Status | null {
  if (!key || !ctx) return null;
  if (key === 'session') {
    return { state: 'info', text: 'par terminal', title: 'Connexion propre à chaque session PowerShell : non visible depuis le portail' };
  }
  if (key === 'azureCli' || key === 'azPowerShell') {
    const az = ctx[key];
    if (!az) return { state: 'off', text: 'non connecté' };
    const title = `${az.user}\n${az.subscription} (${az.subscriptionId})\nTenant ${az.tenantId}`;
    // Le tenant du workspace n'est comparable que sous forme de GUID
    if (s.tenant && GUID_RE.test(s.tenant) && s.tenant.toLowerCase() !== az.tenantId.toLowerCase()) {
      return { state: 'warn', text: 'autre tenant', title };
    }
    if (s.subscription && s.subscription.toLowerCase() !== az.subscriptionId.toLowerCase()) {
      return { state: 'warn', text: 'autre abonnement', title };
    }
    return { state: 'on', text: az.subscription || az.user, title };
  }
  if (key === 'kubernetes') {
    return ctx.kubernetes ? { state: 'on', text: ctx.kubernetes.context } : { state: 'off', text: 'aucun contexte' };
  }
  return ctx.github
    ? { state: 'on', text: ctx.github.user || ctx.github.host, title: ctx.github.host }
    : { state: 'off', text: 'non connecté' };
}

export function CopyButton({ text }: { text: string }) {
  const [label, setLabel] = useState('Copier');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setLabel('Copié');
    } catch {
      setLabel('Échec');
    }
    window.setTimeout(() => setLabel('Copier'), 1500);
  };
  return <button type="button" class="copy" onClick={copy} aria-label={`Copier : ${text}`}>{label}</button>;
}

function CommandRow({ cmd, status, target, onInsert }: {
  cmd: ConnectionCommand;
  status: Status | null;
  target: TerminalRef | null;
  onInsert: (cmd: ConnectionCommand, target: TerminalRef) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const insertTitle = target
    ? `Saisir dans ${target.title}, sans l'exécuter`
    : cmd.shell === 'pwsh'
      ? 'Commande PowerShell : ouvrez un terminal PowerShell'
      : 'Ouvrez un terminal dans ce workspace';
  return (
    <li class="conn-item" data-cmd={cmd.id}>
      <div class="conn-head">
        <span class="conn-label">{cmd.label}</span>
        {cmd.shell === 'pwsh' && <span class="conn-shell" title="Cmdlet PowerShell">PS</span>}
        {status && <span class={`conn-status ${status.state}`} title={status.title}>{status.text}</span>}
      </div>
      <code class="conn-cmd">{cmd.command}</code>
      <div class="conn-actions">
        {cmd.missing.length > 0 && <span class="conn-missing">à compléter : {cmd.missing.join(', ')}</span>}
        <CopyButton text={cmd.command} />
        <button type="button" class="copy insert" disabled={!target || busy} title={insertTitle}
          aria-label={`Insérer : ${cmd.label}`}
          onClick={async () => {
            if (!target) return;
            setBusy(true);
            await onInsert(cmd, target);
            setBusy(false);
          }}>
          ▶ {target ? target.title : 'Insérer'}
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
  const ctx = useCloudContext();
  const [filter, setFilter] = useState('');
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);
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
      setMessage({ text: `Saisi dans ${target.title} : relisez, puis Entrée pour exécuter.` });
      dock?.focusPanel(target.panelId);
    } catch (err) {
      setMessage({ text: (err as Error).message, error: true });
    }
  };

  return (
    <aside class="conn-drawer" aria-label="Connexions"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div class="conn-top">
        <h2>Connexions</h2>
        <button type="button" class="dialog-close" aria-label="Fermer le panneau Connexions" title="Fermer (Échap)"
          onClick={onClose}>×</button>
      </div>
      <input ref={filterRef} class="conn-filter" type="search" placeholder="Filtrer (graph, pnp, az…)" value={filter}
        onInput={(e) => setFilter(e.currentTarget.value)} aria-label="Filtrer les commandes" />
      <p class="conn-settings muted">
        {configured
          ? <>Complétées avec les paramètres du workspace{settings.tenant && <> (tenant <code>{settings.tenant}</code>)</>}.</>
          : <>Renseignez le tenant et les identifiants du workspace pour obtenir des commandes complètes.</>}
        {' '}<button type="button" class="link-button" onClick={onEditSettings}>Paramètres</button>
      </p>
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
        {cmds.length === 0 && <p class="muted">Aucune commande ne correspond.</p>}
      </div>
      <p class="conn-foot muted">
        ▶ saisit la commande dans le dernier terminal utilisé (PowerShell pour les cmdlets), sans l'exécuter.
        Raccourci : Ctrl+Maj+K.
      </p>
    </aside>
  );
}
