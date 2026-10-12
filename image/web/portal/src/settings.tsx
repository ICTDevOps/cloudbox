// Paramètres d'un workspace : nom, environnement et valeurs de connexion (tenant, abonnement,
// SharePoint, ClientId) reprises par le panneau Connexions. Validation définitive par cloudbox-api.
import { useState } from 'preact/hooks';
import { api, ENV_LABELS, ENVS, type Env, type Workspace, type WorkspaceSettings } from './api';

const FIELDS: { key: keyof WorkspaceSettings; label: string; placeholder: string; help: string }[] = [
  { key: 'tenant', label: 'Tenant', placeholder: 'contoso.onmicrosoft.com ou GUID',
    help: 'az, azd, Az PowerShell, Graph, Teams, PnP, m365. Le GUID permet de vérifier le tenant de la connexion az.' },
  { key: 'subscription', label: 'Abonnement Azure (GUID)', placeholder: '00000000-0000-0000-0000-000000000000',
    help: 'az account set, Connect-AzAccount.' },
  { key: 'sharepointUrl', label: 'URL SharePoint', placeholder: 'https://contoso.sharepoint.com',
    help: 'PnP PowerShell. Déduite du tenant <nom>.onmicrosoft.com si vide.' },
  { key: 'clientId', label: "ClientId de l'application Entra", placeholder: '00000000-0000-0000-0000-000000000000',
    help: 'PnP PowerShell et CLI for Microsoft 365 (application à enregistrer dans le tenant).' },
];

export function WorkspaceSettingsForm({ ws, onSaved, onCancel }: {
  ws: Workspace;
  onSaved: (ws: Workspace) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(ws.name);
  const [env, setEnv] = useState<Env>(ws.env);
  const [values, setValues] = useState<WorkspaceSettings>({ ...ws.settings });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: Event) => {
    event.preventDefault();
    setError('');
    if (env === 'prd' && ws.env !== 'prd' && !window.confirm('Passer ce workspace en PRD (production) ?')) return;
    setBusy(true);
    const settings: WorkspaceSettings = {};
    for (const f of FIELDS) {
      const v = values[f.key]?.trim();
      if (v) settings[f.key] = v;
    }
    try {
      const saved = await api.updateWorkspace(ws.id, { name: name.trim(), env, settings });
      onSaved({ ...ws, name: saved.name, env: saved.env, settings });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form class="card create-ws ws-settings" onSubmit={submit}>
      <h2>Paramètres du workspace</h2>
      <label>
        Nom
        <input value={name} onInput={(e) => setName(e.currentTarget.value)} required maxLength={64} />
      </label>
      <fieldset class="env-choice">
        <legend>Environnement</legend>
        {ENVS.map((value) => (
          <label class={`env-option env-${value}${env === value ? ' selected' : ''}`} key={value}>
            <input type="radio" name="settings-env" value={value} checked={env === value} onChange={() => setEnv(value)} />
            {ENV_LABELS[value]}
          </label>
        ))}
      </fieldset>
      <h3 class="settings-sub">Connexions</h3>
      {FIELDS.map((f) => (
        <label key={f.key}>
          {f.label}
          <input name={f.key} value={values[f.key] ?? ''} placeholder={f.placeholder} spellcheck={false} autocomplete="off"
            onInput={(e) => setValues({ ...values, [f.key]: e.currentTarget.value })} />
          <span class="field-help">{f.help}</span>
        </label>
      ))}
      <p class="muted field-help">
        Identifiant <code>{ws.id}</code> et dossier <code>{ws.folder}</code> : non modifiables.
      </p>
      {error && <p class="error" role="alert">{error}</p>}
      <div class="ws-actions">
        <button type="submit" class="button primary" disabled={busy}>Enregistrer</button>
        <button type="button" class="button ghost" onClick={onCancel}>Annuler</button>
      </div>
    </form>
  );
}
