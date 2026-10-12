// Langue de l'interface (français ou anglais). Choix mémorisé dans le navigateur
// (localStorage cloudbox.lang, partagé avec la page de connexion et les terminaux) ; à défaut,
// langue du navigateur. Toute chaîne affichée passe par ces dictionnaires : le dictionnaire
// anglais a le type du français, une traduction manquante ne compile pas.
import { useEffect, useState } from 'preact/hooks';

export type Lang = 'fr' | 'en';
export const LANGS: readonly Lang[] = ['fr', 'en'];
const KEY = 'cloudbox.lang';

function detect(): Lang {
  try {
    const stored = window.localStorage.getItem(KEY);
    if (stored === 'fr' || stored === 'en') return stored;
  } catch {
    // stockage indisponible
  }
  return (navigator.language || '').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

let lang: Lang = detect();
document.documentElement.lang = lang;
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return lang;
}

export function setLang(next: Lang): void {
  if (next === lang) return;
  lang = next;
  document.documentElement.lang = next;
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    // préférence non mémorisée
  }
  listeners.forEach((l) => l());
}

// Abonne le composant aux changements de langue (le composant racine suffit : tout l'arbre est
// alors rendu de nouveau)
export function useLang(): Lang {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const l = () => setVersion((v) => v + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return lang;
}

const fr = {
  common: {
    close: 'Fermer',
    cancel: 'Annuler',
    save: 'Enregistrer',
    delete: 'Supprimer',
    loading: 'Chargement…',
    name: 'Nom',
    environment: 'Environnement',
    settings: 'Paramètres',
    connections: 'Connexions',
    sessionExpired: 'Session expirée',
    error: (status: number) => `Erreur ${status}`,
  },
  login: {
    title: 'Cloudbox — connexion',
    intro: "Saisissez le jeton d'accès affiché par le script d'installation ou par",
    label: "Jeton d'accès",
    submit: 'Se connecter',
    invalid: 'Jeton invalide.',
    hint: 'Le jeton est aussi dans le volume :',
  },
  sidebar: {
    navigation: 'Navigation',
    home: 'Accueil',
    expand: 'Déplier le menu',
    collapse: 'Replier le menu',
    workspaces: 'Workspaces',
    none: 'Aucun workspace',
    alive: 'Ouvert : terminaux et VS Code restent chargés',
    newWorkspace: 'Nouveau workspace',
    logout: 'Se déconnecter',
    language: 'Langue',
  },
  create: {
    title: 'Nouveau workspace',
    namePlaceholder: 'Client A — production',
    id: 'Identifiant',
    idPlaceholder: '<identifiant>',
    invalidId: 'Identifiant invalide : lettres minuscules, chiffres et tirets (32 caractères max.).',
    folder: 'Dossier de travail',
    submit: 'Créer et ouvrir',
  },
  home: {
    title: 'Accueil',
    heading: "Votre poste d'administration Azure et Microsoft 365",
    intro:
      'Ouvrez ou créez un workspace dans le menu de gauche : il regroupe vos terminaux PowerShell et Bash ' +
      'et VS Code pour un client, un projet ou un environnement.',
    firstWorkspace: 'Créer mon premier workspace',
    inEachWorkspace: 'Dans chaque workspace',
    pwsh1:
      'Shell par défaut des terminaux. Modules préinstallés : Az, Microsoft.Graph, ExchangeOnlineManagement, ' +
      'MicrosoftTeams, PnP.PowerShell.',
    pwsh2a: "Le prompt affiche l'environnement du workspace et le contexte réel : abonnement az CLI (",
    pwsh2b: ') et contexte Az PowerShell (',
    pwsh2c: ').',
    bash1: 'Les mêmes outils en ligne de commande : az, azd, Bicep, kubectl, helm, k9s, OpenTofu, Terraform, gh, m365…',
    bash2: 'Complétion activée (az, kubectl, helm, gh, tofu…) et prompt avec la branche git et le contexte Kubernetes.',
    code1: 'VS Code dans le navigateur (code-server), ouvert sur le dossier du workspace, avec son terminal intégré.',
    extensions: 'Extensions',
    tips: 'Astuces',
    tipRightClick: 'Clic droit',
    tipMenu: 'menu tmux (scinder, fermer)',
    tipSelection: 'Sélection',
    tipCopy: 'copie',
    tipPaste: 'colle',
    tipShift: 'Maj',
    tipConnections: 'commandes de connexion',
    tools: "Outils de l'image",
    filter: 'Filtrer (az, kubectl, Graph…)',
    filterLabel: 'Filtrer les outils',
    built: (date: string, arch: string) => `Image construite le ${date} (${arch})`,
    command: (cmd: string) => `Commande : ${cmd}`,
    unavailable: 'non disponible',
    versionsUnavailable: 'Versions indisponibles.',
    noTool: 'Aucun outil ne correspond.',
    // Catégories de cloudbox-versions (en français dans versions.json)
    categories: {} as Record<string, string>,
  },
  workspace: {
    back: "Retour à l'accueil",
    codeOpen: 'VS Code est déjà ouvert dans ce workspace',
    autosave: 'Disposition enregistrée automatiquement',
    settingsTitle: 'Nom, environnement, tenant, identifiants',
    connectionsTitle: 'Commandes de connexion (Ctrl+Maj+K)',
    settingsDialog: 'Paramètres du workspace',
  },
  dock: {
    closeCode: 'Fermer VS Code',
    closeTerminal: 'Fermer ce terminal et arrêter sa session',
    confirmClose: (title: string, session: string) => `Fermer « ${title} » ?\n\nLa session ${session} sera arrêtée.`,
  },
  context: {
    loading: 'Contexte…',
    unavailable: 'Contexte indisponible',
    label: 'Contexte cloud réel',
    notConnected: 'non connecté',
    noContext: 'aucun contexte',
    subscription: 'Abonnement',
    tenant: 'Tenant',
    account: 'Compte',
    cloud: 'Cloud',
    hintAz: 'Azure CLI : abonnement par défaut (az account show)',
    hintAzPs: "Az PowerShell : contexte enregistré (Get-AzContext), distinct de celui d'Azure CLI",
    kubeContext: 'Contexte kubectl',
    namespace: 'Namespace',
    shared: 'partagé entre workspaces',
    sharedTitle:
      'Les connexions az, Az PowerShell et kubectl ne sont pas encore isolées par workspace : ' +
      'tous les workspaces utilisent ce même contexte.',
  },
  conn: {
    groupAzure: 'Azure',
    groupM365: 'Microsoft 365',
    groupTools: 'Outils',
    azSub: 'Azure CLI : abonnement',
    subscriptionPlaceholder: 'abonnement',
    perTerminal: 'par terminal',
    perTerminalTitle: 'Connexion propre à chaque session PowerShell : non visible depuis le portail',
    otherTenant: 'autre tenant',
    otherSubscription: 'autre abonnement',
    copy: 'Copier',
    copied: 'Copié',
    copyFailed: 'Échec',
    copyLabel: (text: string) => `Copier : ${text}`,
    insertInto: (title: string) => `Saisir dans ${title}, sans l'exécuter`,
    needPwsh: 'Commande PowerShell : ouvrez un terminal PowerShell',
    needTerminal: 'Ouvrez un terminal dans ce workspace',
    cmdlet: 'Cmdlet PowerShell',
    toComplete: 'à compléter :',
    insert: 'Insérer',
    insertLabel: (label: string) => `Insérer : ${label}`,
    closePanel: 'Fermer le panneau Connexions',
    closeEsc: 'Fermer (Échap)',
    filter: 'Filtrer (graph, pnp, az…)',
    filterLabel: 'Filtrer les commandes',
    completedWith: 'Complétées avec les paramètres du workspace',
    tenant: 'tenant',
    fillIn: 'Renseignez le tenant et les identifiants du workspace pour obtenir des commandes complètes.',
    inserted: (title: string) => `Saisi dans ${title} : relisez, puis Entrée pour exécuter.`,
    none: 'Aucune commande ne correspond.',
    foot:
      "▶ saisit la commande dans le dernier terminal utilisé (PowerShell pour les cmdlets), sans l'exécuter. " +
      'Raccourci : Ctrl+Maj+K.',
  },
  settings: {
    title: 'Paramètres du workspace',
    connections: 'Connexions',
    tenant: 'Tenant',
    tenantPlaceholder: 'contoso.onmicrosoft.com ou GUID',
    tenantHelp: 'az, azd, Az PowerShell, Graph, Teams, PnP, m365. Le GUID permet de vérifier le tenant de la connexion az.',
    subscription: 'Abonnement Azure (GUID)',
    subscriptionHelp: 'az account set, Connect-AzAccount.',
    sharepoint: 'URL SharePoint',
    sharepointHelp: 'PnP PowerShell. Déduite du tenant <nom>.onmicrosoft.com si vide.',
    clientId: "ClientId de l'application Entra",
    clientIdHelp: 'PnP PowerShell et CLI for Microsoft 365 (application à enregistrer dans le tenant).',
    fixed: (id: string, folder: string) => [`Identifiant `, id, ` et dossier `, folder, ` : non modifiables.`] as string[],
    confirmPrd: 'Passer ce workspace en PRD (production) ?',
    deleteTitle: 'Supprimer ce workspace',
    deleteHelp: 'Ferme ses sessions de terminal ; le dossier de travail est conservé.',
    confirmDelete: (name: string, folder: string) =>
      `Supprimer le workspace « ${name} » ?\n\nSes sessions de terminal seront fermées.\nLe dossier ${folder} est conservé.`,
  },
};

export type Messages = typeof fr;

const en: Messages = {
  common: {
    close: 'Close',
    cancel: 'Cancel',
    save: 'Save',
    delete: 'Delete',
    loading: 'Loading…',
    name: 'Name',
    environment: 'Environment',
    settings: 'Settings',
    connections: 'Connections',
    sessionExpired: 'Session expired',
    error: (status) => `Error ${status}`,
  },
  login: {
    title: 'Cloudbox — sign in',
    intro: 'Enter the access token shown by the installation script or by',
    label: 'Access token',
    submit: 'Sign in',
    invalid: 'Invalid token.',
    hint: 'The token is also stored in the volume:',
  },
  sidebar: {
    navigation: 'Navigation',
    home: 'Home',
    expand: 'Expand menu',
    collapse: 'Collapse menu',
    workspaces: 'Workspaces',
    none: 'No workspace',
    alive: 'Open: terminals and VS Code stay loaded',
    newWorkspace: 'New workspace',
    logout: 'Sign out',
    language: 'Language',
  },
  create: {
    title: 'New workspace',
    namePlaceholder: 'Customer A — production',
    id: 'ID',
    idPlaceholder: '<id>',
    invalidId: 'Invalid ID: lowercase letters, digits and hyphens (32 characters max.).',
    folder: 'Working folder',
    submit: 'Create and open',
  },
  home: {
    title: 'Home',
    heading: 'Your Azure and Microsoft 365 administration workstation',
    intro:
      'Open or create a workspace from the left menu: it groups your PowerShell and Bash terminals ' +
      'and VS Code for a customer, a project or an environment.',
    firstWorkspace: 'Create my first workspace',
    inEachWorkspace: 'In every workspace',
    pwsh1:
      'Default shell of the terminals. Preinstalled modules: Az, Microsoft.Graph, ExchangeOnlineManagement, ' +
      'MicrosoftTeams, PnP.PowerShell.',
    pwsh2a: 'The prompt shows the workspace environment and the actual context: az CLI subscription (',
    pwsh2b: ') and Az PowerShell context (',
    pwsh2c: ').',
    bash1: 'The same command-line tools: az, azd, Bicep, kubectl, helm, k9s, OpenTofu, Terraform, gh, m365…',
    bash2: 'Completion enabled (az, kubectl, helm, gh, tofu…) and a prompt with the git branch and Kubernetes context.',
    code1: 'VS Code in the browser (code-server), opened on the workspace folder, with its integrated terminal.',
    extensions: 'Extensions',
    tips: 'Tips',
    tipRightClick: 'Right-click',
    tipMenu: 'tmux menu (split, close)',
    tipSelection: 'Selection',
    tipCopy: 'copies',
    tipPaste: 'pastes',
    tipShift: 'Shift',
    tipConnections: 'sign-in commands',
    tools: 'Tools in the image',
    filter: 'Filter (az, kubectl, Graph…)',
    filterLabel: 'Filter tools',
    built: (date, arch) => `Image built on ${date} (${arch})`,
    command: (cmd) => `Command: ${cmd}`,
    unavailable: 'not available',
    versionsUnavailable: 'Versions unavailable.',
    noTool: 'No matching tool.',
    categories: {
      Outils: 'Tools',
      'Modules PowerShell': 'PowerShell modules',
      'Interface web': 'Web interface',
      'Extensions VS Code': 'VS Code extensions',
    },
  },
  workspace: {
    back: 'Back to home',
    codeOpen: 'VS Code is already open in this workspace',
    autosave: 'Layout saved automatically',
    settingsTitle: 'Name, environment, tenant, IDs',
    connectionsTitle: 'Sign-in commands (Ctrl+Shift+K)',
    settingsDialog: 'Workspace settings',
  },
  dock: {
    closeCode: 'Close VS Code',
    closeTerminal: 'Close this terminal and stop its session',
    confirmClose: (title, session) => `Close “${title}”?\n\nSession ${session} will be stopped.`,
  },
  context: {
    loading: 'Context…',
    unavailable: 'Context unavailable',
    label: 'Actual cloud context',
    notConnected: 'not signed in',
    noContext: 'no context',
    subscription: 'Subscription',
    tenant: 'Tenant',
    account: 'Account',
    cloud: 'Cloud',
    hintAz: 'Azure CLI: default subscription (az account show)',
    hintAzPs: 'Az PowerShell: saved context (Get-AzContext), separate from the Azure CLI one',
    kubeContext: 'kubectl context',
    namespace: 'Namespace',
    shared: 'shared across workspaces',
    sharedTitle:
      'The az, Az PowerShell and kubectl sign-ins are not isolated per workspace yet: ' +
      'all workspaces use this same context.',
  },
  conn: {
    groupAzure: 'Azure',
    groupM365: 'Microsoft 365',
    groupTools: 'Tools',
    azSub: 'Azure CLI: subscription',
    subscriptionPlaceholder: 'subscription',
    perTerminal: 'per terminal',
    perTerminalTitle: 'Sign-in specific to each PowerShell session: not visible from the portal',
    otherTenant: 'other tenant',
    otherSubscription: 'other subscription',
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: 'Failed',
    copyLabel: (text) => `Copy: ${text}`,
    insertInto: (title) => `Type into ${title}, without running it`,
    needPwsh: 'PowerShell command: open a PowerShell terminal',
    needTerminal: 'Open a terminal in this workspace',
    cmdlet: 'PowerShell cmdlet',
    toComplete: 'to fill in:',
    insert: 'Insert',
    insertLabel: (label) => `Insert: ${label}`,
    closePanel: 'Close the Connections panel',
    closeEsc: 'Close (Esc)',
    filter: 'Filter (graph, pnp, az…)',
    filterLabel: 'Filter commands',
    completedWith: 'Completed with the workspace settings',
    tenant: 'tenant',
    fillIn: 'Fill in the workspace tenant and IDs to get complete commands.',
    inserted: (title) => `Typed into ${title}: review it, then press Enter to run.`,
    none: 'No matching command.',
    foot:
      '▶ types the command into the last terminal used (PowerShell for cmdlets), without running it. ' +
      'Shortcut: Ctrl+Shift+K.',
  },
  settings: {
    title: 'Workspace settings',
    connections: 'Connections',
    tenant: 'Tenant',
    tenantPlaceholder: 'contoso.onmicrosoft.com or GUID',
    tenantHelp: 'az, azd, Az PowerShell, Graph, Teams, PnP, m365. The GUID lets the portal check the tenant of the az sign-in.',
    subscription: 'Azure subscription (GUID)',
    subscriptionHelp: 'az account set, Connect-AzAccount.',
    sharepoint: 'SharePoint URL',
    sharepointHelp: 'PnP PowerShell. Derived from a <name>.onmicrosoft.com tenant if empty.',
    clientId: 'Entra application ClientId',
    clientIdHelp: 'PnP PowerShell and CLI for Microsoft 365 (application to register in the tenant).',
    fixed: (id, folder) => [`ID `, id, ` and folder `, folder, `: cannot be changed.`],
    confirmPrd: 'Switch this workspace to PRD (production)?',
    deleteTitle: 'Delete this workspace',
    deleteHelp: 'Closes its terminal sessions; the working folder is kept.',
    confirmDelete: (name, folder) =>
      `Delete workspace “${name}”?\n\nIts terminal sessions will be closed.\nFolder ${folder} is kept.`,
  },
};

const MESSAGES: Record<Lang, Messages> = { fr, en };

// Messages de la langue courante (à appeler pendant le rendu)
export function t(): Messages {
  return MESSAGES[lang];
}
