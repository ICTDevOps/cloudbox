// Paramètres d'un workspace : nom, environnement, connexions des terminaux (isolées ou partagées),
// valeurs de connexion (tenant, abonnement, SharePoint, ClientId) reprises par l'aide-mémoire, modèle
// propre de l'assistant.
// Validation définitive par cloudbox-api.
import { useState } from 'preact/hooks';
import { api, ENV_LABELS, ENVS, type Env, type IdentityMode, type ModelChoice, type Workspace, type WorkspaceSettings } from './api';
import { ModelPicker } from './ai-settings';
import { useAssistantConfig } from './assistant';
import { t } from './i18n';
import { Icon } from './icons';

type Field = { key: keyof WorkspaceSettings; label: string; placeholder: string; help: string };

function fields(): Field[] {
  const m = t().settings;
  const guid = '00000000-0000-0000-0000-000000000000';
  return [
    { key: 'tenant', label: m.tenant, placeholder: m.tenantPlaceholder, help: m.tenantHelp },
    { key: 'subscription', label: m.subscription, placeholder: guid, help: m.subscriptionHelp },
    { key: 'sharepointUrl', label: m.sharepoint, placeholder: 'https://contoso.sharepoint.com', help: m.sharepointHelp },
    { key: 'clientId', label: m.clientId, placeholder: guid, help: m.clientIdHelp },
  ];
}

// Connexions des terminaux du workspace : isolées (défaut) ou partagées avec les autres workspaces
export function IdentityChoice({ name, value, onChange }: { name: string; value: IdentityMode; onChange: (v: IdentityMode) => void }) {
  const m = t().identities;
  const options: { value: IdentityMode; icon: 'lock' | 'share'; title: string; help: string }[] = [
    { value: 'isolated', icon: 'lock', title: m.isolated, help: m.isolatedHelp },
    { value: 'shared', icon: 'share', title: m.shared, help: m.sharedHelp },
  ];
  return (
    <div class="identity-choice">
      {options.map((o) => (
        <label class={`identity-option${value === o.value ? ' selected' : ''}`} key={o.value}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          <Icon name={o.icon} size={18} />
          <span><strong>{o.title}</strong><small>{o.help}</small></span>
        </label>
      ))}
    </div>
  );
}

export function WorkspaceSettingsForm({ ws, onSaved, onCancel }: {
  ws: Workspace;
  onSaved: (ws: Workspace) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(ws.name);
  const [env, setEnv] = useState<Env>(ws.env);
  const [values, setValues] = useState<WorkspaceSettings>({ ...ws.settings });
  const [model, setModel] = useState<ModelChoice | null>(ws.assistant ?? null);
  const [identities, setIdentities] = useState<IdentityMode>(ws.identities ?? 'isolated');
  const assistant = useAssistantConfig();
  const aiProviders = assistant?.enabled ? assistant.providers.filter((p) => p.configured) : [];
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const m = t();
  const FIELDS = fields();

  const submit = async (event: Event) => {
    event.preventDefault();
    setError('');
    if (env === 'prd' && ws.env !== 'prd' && !window.confirm(m.settings.confirmPrd)) return;
    setBusy(true);
    const settings: WorkspaceSettings = {};
    for (const f of FIELDS) {
      const v = values[f.key]?.trim();
      if (v) settings[f.key] = v;
    }
    try {
      const saved = await api.updateWorkspace(ws.id, { name: name.trim(), env, settings, assistant: model, identities });
      onSaved({ ...ws, name: saved.name, env: saved.env, settings, assistant: model ?? undefined, identities });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form class="card create-ws ws-settings" onSubmit={submit}>
      <div class="dialog-head">
        <span class="icon-tile large"><Icon name="gear" size={28} /></span>
        <div>
          <h2>{m.settings.title}</h2>
          <p>{ws.name}</p>
        </div>
      </div>
      <label>
        {m.common.name}
        <input value={name} onInput={(e) => setName(e.currentTarget.value)} required maxLength={64} />
      </label>
      <fieldset class="env-choice">
        <legend>{m.common.environment}</legend>
        {ENVS.map((value) => (
          <label class={`env-option env-${value}${env === value ? ' selected' : ''}`} key={value}>
            <input type="radio" name="settings-env" value={value} checked={env === value} onChange={() => setEnv(value)} />
            <Icon name="cube" size={18} />
            {ENV_LABELS[value]}
          </label>
        ))}
      </fieldset>
      <fieldset class="identities-field">
        <legend>{m.identities.title}</legend>
        <IdentityChoice name="settings-identities" value={identities} onChange={setIdentities} />
        {identities !== (ws.identities ?? 'isolated') && <span class="field-help warn">{m.identities.reopen}</span>}
      </fieldset>
      <h3 class="settings-sub">{m.settings.connections}</h3>
      {FIELDS.map((f) => (
        <label key={f.key}>
          {f.label}
          <input name={f.key} value={values[f.key] ?? ''} placeholder={f.placeholder} spellcheck={false} autocomplete="off"
            onInput={(e) => setValues({ ...values, [f.key]: e.currentTarget.value })} />
          <span class="field-help">{f.help}</span>
        </label>
      ))}
      {aiProviders.length > 0 && (
        <>
          <h3 class="settings-sub">{m.settings.assistant}</h3>
          <p class="field-label">{m.settings.ownModel}</p>
          <ModelPicker providers={aiProviders} value={model} onChange={setModel} allowNone />
          <span class="field-help">{m.settings.ownModelHelp(assistant?.default?.model ?? '')}</span>
        </>
      )}
      <p class="muted field-help">
        {m.settings.fixed(ws.id, ws.folder).map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))}
      </p>
      {error && <p class="error" role="alert">{error}</p>}
      <div class="ws-actions">
        <button type="submit" class="button primary" disabled={busy}>{m.common.save}</button>
        <button type="button" class="button ghost" onClick={onCancel}>{m.common.cancel}</button>
      </div>
    </form>
  );
}
