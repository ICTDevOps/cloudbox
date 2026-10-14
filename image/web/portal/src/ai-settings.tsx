// Paramètres de l'assistant IA (communs à tous les workspaces) : activation, fournisseurs et clés API,
// modèle par défaut. Les clés sont envoyées à cloudbox-api et ne reviennent jamais : seuls leurs
// 4 derniers caractères sont affichés.
import { useState } from 'preact/hooks';
import { api, type AssistantConfig, type ProviderInfo, type ProviderUpdate } from './api';
import { assistantConfigStore, useAssistantConfig } from './assistant';
import { t } from './i18n';

function ProviderRow({ p, onSave, busy }: { p: ProviderInfo; onSave: (u: ProviderUpdate) => Promise<boolean>; busy: boolean }) {
  const m = t().ai;
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(p.baseUrl);
  const [auth, setAuth] = useState(p.auth);
  const status = p.keyFromEnv && p.keyHint ? m.keyEnv(p.keyHint) : p.configured && p.keyHint ? m.keySet(p.keyHint) : m.keyNone;
  const changed = key.trim() !== '' || baseUrl !== p.baseUrl || auth !== p.auth;

  const save = async () => {
    const update: ProviderUpdate = { id: p.id };
    if (key.trim()) update.apiKey = key.trim();
    if (baseUrl !== p.baseUrl) update.baseUrl = baseUrl.trim();
    if (auth !== p.auth) update.auth = auth;
    if (await onSave(update)) setKey('');
  };

  return (
    <li class="ai-provider">
      <div class="ai-provider-head">
        <strong>{p.label}</strong>
        <span class={`conn-status ${p.configured ? 'on' : 'off'}`}>{status}</span>
      </div>
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
      <div class="ai-key">
        <input type="password" value={key} placeholder={m.keyPlaceholder} autocomplete="off" spellcheck={false}
          aria-label={`${p.label} — ${m.keyPlaceholder}`} onInput={(e) => setKey(e.currentTarget.value)} />
        <button type="button" class="button primary small" disabled={busy || !changed} onClick={save}>{t().common.save}</button>
        {p.configured && !p.keyFromEnv && (
          <button type="button" class="button ghost small" disabled={busy} onClick={() => onSave({ id: p.id, apiKey: null })}>{m.removeKey}</button>
        )}
        {!p.preset && (
          <button type="button" class="button danger small" disabled={busy} onClick={() => onSave({ id: p.id, remove: true })}>{m.removeProvider}</button>
        )}
      </div>
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
    <div class="ai-provider">
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

export function AiSettingsForm({ onClose }: { onClose: () => void }) {
  const m = t().ai;
  const cfg = useAssistantConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [defProvider, setDefProvider] = useState(cfg?.default?.provider ?? '');
  const [defModel, setDefModel] = useState(cfg?.default?.model ?? '');
  const [models, setModels] = useState<string[]>([]);

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

  if (!cfg) return <div class="card create-ws"><p class="muted">{t().common.loading}</p></div>;
  const configured = cfg.providers.filter((p) => p.configured);
  const provider = defProvider || configured[0]?.id || '';

  const loadModels = async () => {
    if (!provider) return;
    setError('');
    try {
      const list = await api.assistantModels(provider);
      setModels(list);
      setMessage(m.modelsLoaded(list.length));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div class="card create-ws ai-settings">
      <h2>{m.title}</h2>
      {!cfg.allowed ? (
        <p class="error">{m.forbidden}</p>
      ) : (
        <>
          <label class="ai-enable">
            <input type="checkbox" checked={cfg.enabled} disabled={busy} onChange={(e) => apply({ enabled: e.currentTarget.checked })} />
            {m.enable}
          </label>
          <p class="field-help">{m.enableHelp}</p>

          <h3 class="settings-sub">{m.providers}</h3>
          <ul class="ai-providers">
            {cfg.providers.map((p) => <ProviderRow key={`${p.id}-${p.keyHint}-${p.baseUrl}`} p={p} busy={busy} onSave={(u) => apply({ providers: [u] })} />)}
          </ul>
          <AddProvider busy={busy} onSave={(u) => apply({ providers: [u] })} />
          <p class="field-help">{m.subscriptions}</p>

          <h3 class="settings-sub">{m.defaultModel}</h3>
          <div class="ai-default">
            <select value={provider} onChange={(e) => { setDefProvider(e.currentTarget.value); setModels([]); }} aria-label={t().assistant.provider}>
              {configured.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <input list="ai-default-models" value={defModel} placeholder={t().assistant.modelPlaceholder} spellcheck={false}
              aria-label={t().assistant.model} onInput={(e) => setDefModel(e.currentTarget.value.trim())} />
            <datalist id="ai-default-models">{models.map((id) => <option key={id} value={id} />)}</datalist>
            <button type="button" class="button ghost small" disabled={!provider} onClick={loadModels}>{m.loadModels}</button>
            <button type="button" class="button primary small" disabled={busy || !provider || !defModel}
              onClick={() => apply({ default: { provider, model: defModel } })}>{t().common.save}</button>
          </div>
          <p class="field-help">{m.privacy}</p>
        </>
      )}
      {error && <p class="error" role="alert">{error}</p>}
      {message && <p class="muted" role="status">{message}</p>}
      <div class="ws-actions">
        <button type="button" class="button ghost" onClick={onClose}>{t().common.close}</button>
      </div>
    </div>
  );
}
