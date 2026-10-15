// État réel de chaque connexion, pour l'en-tête du workspace, l'aide-mémoire et la barre de chemin des
// terminaux. Toujours lu, jamais déclaré : fichiers de configuration du workspace (az, contexte Az
// PowerShell enregistré), fichier commun de CLI for Microsoft 365, et sessions publiées par le prompt de
// chaque terminal PowerShell (Graph, Exchange, Teams, PnP, contexte Az PowerShell du processus).
import type { CloudContext, TerminalConnection, TerminalService, WorkspaceSettings } from './api';
import { t } from './i18n';

export type ServiceId = 'az' | 'azps' | 'graph' | 'exo' | 'teams' | 'pnp' | 'm365';
export type ServiceGroup = 'azure' | 'm365';
export type ServiceState = 'on' | 'off' | 'warn';

export interface ServiceStatus {
  id: ServiceId;
  group: ServiceGroup;
  label: string; // nom court (en-tête, barre de chemin)
  name: string; // nom complet
  state: ServiceState;
  value: string; // abonnement ou compte (az, Az PowerShell, m365) ; vide sinon
  text: string; // résumé (aide-mémoire) : valeur, terminaux connectés, écart avec le déclaré
  terminals: string[]; // terminaux où la session est ouverte
  detail: string[]; // lignes de l'infobulle
}

export const SERVICES: Record<ServiceId, { label: string; name: string; group: ServiceGroup }> = {
  az: { label: 'az', name: 'Azure CLI', group: 'azure' },
  azps: { label: 'Az PS', name: 'Az PowerShell', group: 'azure' },
  graph: { label: 'Graph', name: 'Microsoft Graph', group: 'm365' },
  exo: { label: 'EXO', name: 'Exchange Online', group: 'm365' },
  teams: { label: 'Teams', name: 'Microsoft Teams', group: 'm365' },
  pnp: { label: 'PnP', name: 'PnP PowerShell', group: 'm365' },
  m365: { label: 'm365', name: 'CLI for Microsoft 365', group: 'm365' },
};

// Services propres à chaque terminal, dans l'ordre d'affichage
export const TERMINAL_SERVICES: readonly TerminalService[] = ['azps', 'graph', 'exo', 'teams', 'pnp'];

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// <workspace>_pwsh_2 → « PowerShell 2 », le titre de l'onglet
export function terminalTitle(session: string): string {
  const [, shell, n] = session.split('_');
  return `${shell === 'pwsh' ? 'PowerShell' : 'Bash'} ${n ?? ''}`.trim();
}

function sep(): string {
  return document.documentElement.lang === 'fr' ? ' : ' : ': ';
}

// Écart avec le tenant (comparable seulement sous forme de GUID) ou l'abonnement déclarés
function mismatch(c: { tenantId?: string; subscriptionId?: string }, s: WorkspaceSettings): string | null {
  const m = t().conn;
  if (s.tenant && GUID_RE.test(s.tenant) && c.tenantId && s.tenant.toLowerCase() !== c.tenantId.toLowerCase()) return m.otherTenant;
  if (s.subscription && c.subscriptionId && s.subscription.toLowerCase() !== c.subscriptionId.toLowerCase()) return m.otherSubscription;
  return null;
}

// Ligne de détail d'une session : compte (ou site PnP), abonnement, tenant
export function connectionLine(c: TerminalConnection): string {
  const m = t().context;
  return [c.url ?? c.user, c.subscription && `${m.subscription} ${c.subscription}`, c.tenantId && `${m.tenant} ${c.tenantId}`]
    .filter(Boolean).join(' · ');
}

// perTerminal : sessions des terminaux PowerShell du workspace (sans objet sur l'accueil)
export function serviceStatuses(ctx: CloudContext, s: WorkspaceSettings = {}, perTerminal = true): ServiceStatus[] {
  const m = t().context;
  const out: ServiceStatus[] = [];
  const make = (id: ServiceId, init: Partial<ServiceStatus>): ServiceStatus => {
    const svc = SERVICES[id];
    const st: ServiceStatus = { id, group: svc.group, label: svc.label, name: svc.name, state: 'off', value: '', text: m.notConnected, terminals: [], detail: [], ...init };
    st.detail = [svc.name, ...st.detail, st.state === 'off' ? m.notConnected : m.sessionNote];
    return st;
  };
  // Sessions ouvertes dans les terminaux, par service
  const open = (service: TerminalService) =>
    perTerminal ? ctx.terminals.flatMap((tm) => (tm.connections[service] ? [{ title: terminalTitle(tm.session), c: tm.connections[service]! }] : [])) : [];

  // az : configuration du workspace
  const az = ctx.azureCli;
  if (az) {
    const warn = mismatch(az, s);
    out.push(make('az', {
      state: warn ? 'warn' : 'on', value: az.subscription || az.user, text: warn ?? (az.subscription || az.user),
      detail: [`${m.subscription}${sep()}${az.subscription} (${az.subscriptionId})`, `${m.tenant}${sep()}${az.tenantId}`,
        `${m.account}${sep()}${az.user}`, m.hintAz],
    }));
  } else out.push(make('az', { detail: [m.hintAz] }));

  // Az PowerShell : contexte enregistré (repris par les nouveaux terminaux) et contexte de chaque terminal
  const saved = ctx.azPowerShell;
  const azps = open('azps');
  if (saved || azps.length) {
    const warn = [saved, ...azps.map((x) => x.c)].map((c) => c && mismatch(c, s)).find(Boolean) ?? null;
    const value = saved ? saved.subscription || saved.user : azps[0].c.subscription || azps[0].c.user || '';
    out.push(make('azps', {
      state: warn ? 'warn' : 'on', value, text: warn ?? value, terminals: azps.map((x) => x.title),
      detail: [
        ...(saved ? [`${m.saved}${sep()}${connectionLine(saved)}`] : []),
        ...azps.map((x) => `${x.title}${sep()}${connectionLine(x.c)}`),
        m.hintAzPs,
      ],
    }));
  } else out.push(make('azps', { detail: [m.hintAzPs] }));

  // Graph, Exchange, Teams, PnP : seulement dans le processus d'un terminal
  if (perTerminal) {
    for (const id of ['graph', 'exo', 'teams', 'pnp'] as const) {
      const list = open(id);
      if (!list.length) {
        out.push(make(id, { detail: [m.noSession] }));
        continue;
      }
      const warn = list.map((x) => mismatch(x.c, s)).find(Boolean) ?? null;
      out.push(make(id, {
        state: warn ? 'warn' : 'on', terminals: list.map((x) => x.title),
        text: warn ?? list.map((x) => x.title).join(', '),
        detail: list.map((x) => `${x.title}${sep()}${connectionLine(x.c)}`),
      }));
    }
  }

  // CLI for Microsoft 365 : connexion commune à tous les workspaces
  const cli = ctx.m365;
  if (cli) {
    const warn = mismatch(cli, s);
    out.push(make('m365', {
      state: warn ? 'warn' : 'on', value: cli.user, text: warn ?? cli.user,
      detail: [`${m.account}${sep()}${cli.user}`, `${m.tenant}${sep()}${cli.tenantId}`, m.common],
    }));
  } else out.push(make('m365', { detail: [m.common] }));
  return out;
}
