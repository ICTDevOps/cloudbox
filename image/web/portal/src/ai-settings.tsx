// Paramètres de l'assistant IA (communs à tous les workspaces), onglet de la fenêtre Paramètres :
// activation, fournisseurs et clés API, modèle par défaut. Les clés sont envoyées à cloudbox-api et
// ne reviennent jamais : seuls leurs 4 derniers caractères sont affichés.
import { useEffect, useState } from 'preact/hooks';
import { api, type AssistantConfig, type ModelChoice, type ProviderInfo, type ProviderUpdate } from './api';
import { assistantConfigStore, useAssistantConfig } from './assistant';
import { t } from './i18n';

// Listes de modèles déjà lues chez les fournisseurs (le temps de la page)
const modelCache = new Map<string, Promise<string[]>>();

function providerModels(provider: string): Promise<string[]> {
  let list = modelCache.get(provider);
  if (!list) {
    list = api.assistantModels(provider);
    modelCache.set(provider, list);
    list.catch(() => modelCache.delete(provider)); // nouvel essai à la prochaine ouverture
  }
  return list;
}

// Choix d'un fournisseur configuré et d'un modèle lu chez lui ; saisie libre si la liste est indisponible.
// Utilisé pour le modèle par défaut et pour le modèle propre à un workspace.
export function ModelPicker({ providers, value, onChange, disabled = false, allowNone = false }: {
  providers: ProviderInfo[];
  value: ModelChoice | null;
  onChange: (choice: ModelChoice | null) => void;
  disabled?: boolean;
  allowNone?: boolean;
}) {
  const m = t().ai;
  const [provider, setProvider] = useState(value?.provider ?? (allowNone ? '' : providers[0]?.id ?? ''));
  const [models, setModels] = useState<string[] | null>(null);
  const [failed, setFailed] = useState('');
  const [filter, setFilter] = useState('');
  const model = value && value.provider === provider ? value.model : '';

  useEffect(() => {
    setModels(null);
    setFailed('');
    setFilter('');
    if (!provider) return;
    let current = true;
    providerModels(provider)
      .then((list) => current && setModels(list))
      .catch((err: Error) => current && setFailed(err.message));
    return () => {
      current = false;
    };
  }, [provider]);

  const selectProvider = (id: string) => {
    setProvider(id);
    if (!id) onChange(null);
  };

  const q = filter.trim().toLowerCase();
  const shown = (models ?? []).filter((id) => !q || id.toLowerCase().includes(q));
  // Le modèle choisi reste visible même s'il ne passe pas le filtre
  if (model && models && !shown.includes(model)) shown.unshift(model);

  return (
    <div class="model-picker">
      <select value={provider} disabled={disabled} aria-label={t().assistant.provider}
        onChange={(e) => selectProvider(e.currentTarget.value)}>
        {allowNone && <option value="">—</option>}
        {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      {provider && failed && (
        <>
          <input value={model} placeholder={t().assistant.modelPlaceholder} spellcheck={false} disabled={disabled}
            aria-label={t().assistant.model}
            onChange={(e) => onChange(e.currentTarget.value.trim() ? { provider, model: e.currentTarget.value.trim() } : null)} />
          <span class="field-help">{m.modelsError(failed)}</span>
        </>
      )}
      {provider && !failed && !models && <span class="muted field-help">{m.modelsLoading}</span>}
      {provider && models && (
        <>
          {models.length > 12 && (
            <input type="search" value={filter} placeholder={m.modelFilter} spellcheck={false} disabled={disabled}
              aria-label={m.modelFilter} onInput={(e) => setFilter(e.currentTarget.value)} />
          )}
          <select value={model} disabled={disabled} aria-label={t().assistant.model}
            onChange={(e) => e.currentTarget.value && onChange({ provider, model: e.currentTarget.value })}>
            {!model && <option value="">{m.chooseModel}</option>}
            {shown.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
          <span class="muted field-help">{m.modelsCount(shown.length, models.length)}</span>
        </>
      )}
    </div>
  );
}

function keyStatus(p: ProviderInfo): string {
  const m = t().ai;
  if (p.keyFromEnv && p.keyHint) return m.keyEnv(p.keyHint);
  if (p.configured && p.keyHint) return m.keySet(p.keyHint);
  return m.keyNone;
}

function ProviderRow({ p, open, onToggle, onSave, busy }: {
  p: ProviderInfo;
  open: boolean;
  onToggle: () => void;
  onSave: (u: ProviderUpdate) => Promise<boolean>;
  busy: boolean;
}) {
  const m = t().ai;
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(p.baseUrl);
  const [auth, setAuth] = useState(p.auth);
  const changed = key.trim() !== '' || baseUrl !== p.baseUrl || auth !== p.auth;

  const save = async () => {
    const update: ProviderUpdate = { id: p.id };
    if (key.trim()) update.apiKey = key.trim();
    if (baseUrl !== p.baseUrl) update.baseUrl = baseUrl.trim();
    if (auth !== p.auth) update.auth = auth;
    if (await onSave(update)) setKey('');
  };

  return (
    <li class={`ai-provider${open ? ' open' : ''}`}>
      <div class="ai-provider-head">
        <strong>{p.label}</strong>
        <span class={`conn-status ${p.configured ? 'on' : 'off'}`}>{keyStatus(p)}</span>
        <button type="button" class="button ghost small" aria-expanded={open} onClick={onToggle}>
          {open ? m.collapse : m.configure}
        </button>
      </div>
      {open && (
        <div class="ai-provider-body">
          <div class="ai-key">
            <input type="password" value={key} placeholder={m.keyPlaceholder} autocomplete="off" spellcheck={false}
              aria-label={`${p.label} — ${m.keyPlaceholder}`} onInput={(e) => setKey(e.currentTarget.value)} />
            <button type="button" class="button primary small" disabled={busy || !changed} onClick={save}>{t().common.save}</button>
            {p.configured && !p.keyFromEnv && (
              <button type="button" class="button ghost small" disabled={busy} onClick={() => onSave({ id: p.id, apiKey: null })}>{m.removeKey}</button>
            )}
          </div>
          <details class="ai-advanced">
            <summary>{m.advanced}</summary>
            <label>
              {m.baseUrl}
              <input value={baseUrl} spellcheck={false} onInput={(e) => setBaseUrl(e.currentTarget.value)} />
            </label>
            {p.type === 'openai-compatible' && !p.preset && (
              <label>
                {m.auth}
                <select value={auth} onChange={(e) => setAuth(e.currentTarget.value as ProviderInfo['auth'])}>
                  <option value="bearer">{m.authBearer}</option>
                  <option value="api-key">{m.authApiKey}</option>
                </select>
              </label>
            )}
            {!p.preset && (
              <button type="button" class="button danger small" disabled={busy} onClick={() => onSave({ id: p.id, remove: true })}>{m.removeProvider}</button>
            )}
          </details>
        </div>
      )}
    </li>
  );
}

function AddProvider({ onSave, busy }: { onSave: (u: ProviderUpdate) => Promise<boolean>; busy: boolean }) {
  const m = t().ai;
  const [open, setOpen] = useState(false);
  const [id, setId] = useState('');
  const [label, setLabel] = useState('');
  const [type, setType] = useState<ProviderInfo['type']>('openai-compatible');
  const [baseUrl, setBaseUrl] = useState('');
  const [auth, setAuth] = useState<ProviderInfo['auth']>('api-key');
  const [key, setKey] = useState('');
  if (!open) return <button type="button" class="link-button" onClick={() => setOpen(true)}>+ {m.addProvider}</button>;
  const submit = async () => {
    const ok = await onSave({ id: id.trim(), label: label.trim(), type, baseUrl: baseUrl.trim(), auth, ...(key.trim() ? { apiKey: key.trim() } : {}) });
    if (ok) setOpen(false);
  };
  return (
    <div class="ai-provider open">
      <label>{m.customId}<input value={id} placeholder="azure-openai" spellcheck={false} onInput={(e) => setId(e.currentTarget.value)} /></label>
      <label>{m.customLabel}<input value={label} placeholder="Azure OpenAI" onInput={(e) => setLabel(e.currentTarget.value)} /></label>
      <label>
        {m.type}
        <select value={type} onChange={(e) => setType(e.currentTarget.value as ProviderInfo['type'])}>
          <option value="openai-compatible">{m.typeOpenAi}</option>
          <option value="anthropic">{m.typeAnthropic}</option>
        </select>
      </label>
      <label>{m.baseUrl}<input value={baseUrl} placeholder="https://<ressource>.openai.azure.com/openai/v1" spellcheck={false}
        onInput={(e) => setBaseUrl(e.currentTarget.value)} /></label>
      {type === 'openai-compatible' && (
        <label>
          {m.auth}
          <select value={auth} onChange={(e) => setAuth(e.currentTarget.value as ProviderInfo['auth'])}>
            <option value="api-key">{m.authApiKey}</option>
            <option value="bearer">{m.authBearer}</option>
          </select>
        </label>
      )}
      <label>{m.keyPlaceholder}<input type="password" value={key} autocomplete="off" onInput={(e) => setKey(e.currentTarget.value)} /></label>
      <div class="ws-actions">
        <button type="button" class="button primary small" disabled={busy || !id || !baseUrl} onClick={submit}>{t().common.save}</button>
        <button type="button" class="button ghost small" onClick={() => setOpen(false)}>{t().common.cancel}</button>
      </div>
    </div>
  );
}

export function AiSettingsForm() {
  const m = t().ai;
  const cfg = useAssistantConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  // Un seul fournisseur déplié ; au départ, le premier sans clé si aucun n'est configuré
  const [openId, setOpenId] = useState<string | null>(null);

  const apply = async (data: Parameters<typeof api.updateAssistantConfig>[0]): Promise<boolean> => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const next: AssistantConfig = await api.updateAssistantConfig(data);
      assistantConfigStore.set(next);
      setMessage(m.saved);
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!cfg) return <p class="muted">{t().common.loading}</p>;
  const configured = cfg.providers.filter((p) => p.configured);
  const expanded = openId ?? (configured.length ? null : cfg.providers[0]?.id ?? null);

  return (
    <div class="prefs-section ai-settings">
      {!cfg.allowed ? (
        <p class="error">{m.forbidden}</p>
      ) : (
        <>
          <label class="ai-enable">
            <input type="checkbox" checked={cfg.enabled} disabled={busy} onChange={(e) => apply({ enabled: e.currentTarget.checked })} />
            {m.enable}
          </label>
          <p class="field-help">{m.enableHelp}</p>

          {cfg.enabled && (
            <>
              <h3 class="settings-sub">{m.providers}</h3>
              <ul class="ai-providers">
                {cfg.providers.map((p) => (
                  <ProviderRow key={`${p.id}-${p.keyHint}-${p.baseUrl}`} p={p} busy={busy} open={expanded === p.id}
                    onToggle={() => setOpenId(expanded === p.id ? '' : p.id)} onSave={(u) => apply({ providers: [u] })} />
                ))}
              </ul>
              <AddProvider busy={busy} onSave={(u) => apply({ providers: [u] })} />

              <h3 class="settings-sub">{m.defaultModel}</h3>
              {configured.length ? (
                <ModelPicker key={configured.map((p) => p.id).join()} providers={configured} value={cfg.default} disabled={busy}
                  onChange={(choice) => choice && apply({ default: choice })} />
              ) : (
                <p class="muted field-help">{m.noConfigured}</p>
              )}
              <p class="field-help">{m.defaultModelHelp}</p>
              <p class="field-help">{m.privacy}</p>
              <p class="field-help">{m.subscriptions}</p>
            </>
          )}
        </>
      )}
      {error && <p class="error" role="alert">{error}</p>}
      {message && <p class="muted" role="status">{message}</p>}
    </div>
  );
}
