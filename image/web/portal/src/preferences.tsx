// Fenêtre Paramètres (barre latérale) : Général (langue, thème), Workspaces (valeurs proposées à la
// création), Assistant IA. Préférences enregistrées dans le volume par cloudbox-api.
import { useState } from 'preact/hooks';
import { api, ENV_LABELS, ENVS, PANEL_KINDS, type Env, type PanelKind, type Theme } from './api';
import { AiSettingsForm } from './ai-settings';
import { useAssistantConfig } from './assistant';
import { getLang, LANGS, setLang, t } from './i18n';
import { prefsStore, usePreferences, type PrefsTab } from './prefs';

const TABS: readonly PrefsTab[] = ['general', 'workspaces', 'ai'];
const TAB_KEY = 'cloudbox.settings.tab';

export function readTab(): PrefsTab {
  try {
    const v = window.localStorage.getItem(TAB_KEY);
    return TABS.includes(v as PrefsTab) ? (v as PrefsTab) : 'general';
  } catch {
    return 'general';
  }
}

function writeTab(tab: PrefsTab): void {
  try {
    window.localStorage.setItem(TAB_KEY, tab);
  } catch {
    // stockage indisponible : onglet non mémorisé
  }
}

export const PANEL_LABELS: Record<PanelKind, string> = { pwsh: 'PowerShell', bash: 'Bash', code: 'VS Code', assistant: '✦ Assistant' };

// Cases des panneaux d'un nouveau workspace (fenêtre Paramètres et formulaire de création)
export function PanelChoice({ value, onChange, name }: { value: PanelKind[]; onChange: (v: PanelKind[]) => void; name: string }) {
  const assistant = useAssistantConfig();
  const m = t().prefs;
  const toggle = (kind: PanelKind, on: boolean) =>
    onChange(PANEL_KINDS.filter((k) => (k === kind ? on : value.includes(k))));
  return (
    <div class="panel-choice" role="group">
      {PANEL_KINDS.map((kind) => {
        const off = kind === 'assistant' && !assistant?.enabled;
        return (
          <label key={kind} class={`panel-option${value.includes(kind) && !off ? ' selected' : ''}${off ? ' disabled' : ''}`}>
            <input type="checkbox" name={name} checked={value.includes(kind) && !off} disabled={off}
              onChange={(e) => toggle(kind, e.currentTarget.checked)} />
            {PANEL_LABELS[kind]}
            {off && <span class="muted"> ({m.assistantOff})</span>}
          </label>
        );
      })}
    </div>
  );
}

function General() {
  const m = t().prefs;
  const prefs = usePreferences();
  const [error, setError] = useState('');
  const setTheme = async (theme: Theme) => {
    setError('');
    try {
      prefsStore.set(await api.updatePreferences({ theme }));
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <div class="prefs-section">
      <fieldset class="seg-choice">
        <legend>{m.language}</legend>
        {LANGS.map((l) => (
          <label key={l} class={getLang() === l ? 'selected' : ''} lang={l}>
            <input type="radio" name="prefs-lang" checked={getLang() === l} onChange={() => setLang(l)} />
            {l === 'fr' ? 'Français' : 'English'}
          </label>
        ))}
      </fieldset>
      <fieldset class="seg-choice">
        <legend>{m.theme}</legend>
        {(['auto', 'light', 'dark'] as const).map((th) => (
          <label key={th} class={(prefs?.theme ?? 'auto') === th ? 'selected' : ''}>
            <input type="radio" name="prefs-theme" checked={(prefs?.theme ?? 'auto') === th} disabled={!prefs}
              onChange={() => setTheme(th)} />
            {m.themes[th]}
          </label>
        ))}
      </fieldset>
      <p class="field-help">{m.themeHelp}</p>
      {error && <p class="error" role="alert">{error}</p>}
    </div>
  );
}

function Workspaces() {
  const m = t().prefs;
  const prefs = usePreferences();
  const [env, setEnv] = useState<Env | null>(null);
  const [panels, setPanels] = useState<PanelKind[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  if (!prefs) return <p class="muted">{t().common.loading}</p>;
  const currentEnv = env ?? prefs.newWorkspace.env;
  const currentPanels = panels ?? prefs.newWorkspace.panels;
  const changed = currentEnv !== prefs.newWorkspace.env || currentPanels.join() !== prefs.newWorkspace.panels.join();

  const save = async () => {
    setError('');
    setMessage('');
    if (!currentPanels.length) {
      setError(m.atLeastOne);
      return;
    }
    setBusy(true);
    try {
      prefsStore.set(await api.updatePreferences({ newWorkspace: { env: currentEnv, panels: currentPanels } }));
      setEnv(null);
      setPanels(null);
      setMessage(m.saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="prefs-section">
      <p class="field-help">{m.newWorkspaceHelp}</p>
      <fieldset class="env-choice">
        <legend>{m.defaultEnv}</legend>
        {ENVS.map((value) => (
          <label class={`env-option env-${value}${currentEnv === value ? ' selected' : ''}`} key={value}>
            <input type="radio" name="prefs-env" value={value} checked={currentEnv === value} onChange={() => setEnv(value)} />
            {ENV_LABELS[value]}
          </label>
        ))}
      </fieldset>
      {currentEnv === 'prd' && <p class="warn">{m.prdWarning}</p>}
      <fieldset>
        <legend>{m.panels}</legend>
        <PanelChoice name="prefs-panels" value={currentPanels} onChange={setPanels} />
      </fieldset>
      {error && <p class="error" role="alert">{error}</p>}
      {message && <p class="muted" role="status">{message}</p>}
      <div class="ws-actions">
        <button type="button" class="button primary" disabled={busy || !changed} onClick={save}>{t().common.save}</button>
      </div>
    </div>
  );
}

export function PreferencesDialog({ tab, onTab }: { tab: PrefsTab; onTab: (tab: PrefsTab) => void }) {
  const m = t().prefs;
  const select = (next: PrefsTab) => {
    writeTab(next);
    onTab(next);
  };
  return (
    <div class="card prefs">
      <h2>{m.title}</h2>
      <div class="prefs-body">
        <div class="prefs-tabs" role="tablist" aria-orientation="vertical">
          {TABS.map((id) => (
            <button type="button" role="tab" key={id} id={`prefs-tab-${id}`} aria-selected={tab === id}
              aria-controls="prefs-panel" class={tab === id ? 'active' : ''} onClick={() => select(id)}>
              {m.tabs[id]}
            </button>
          ))}
        </div>
        <div class="prefs-panel" id="prefs-panel" role="tabpanel" aria-labelledby={`prefs-tab-${tab}`}>
          {tab === 'general' && <General />}
          {tab === 'workspaces' && <Workspaces />}
          {tab === 'ai' && <AiSettingsForm />}
        </div>
      </div>
    </div>
  );
}
