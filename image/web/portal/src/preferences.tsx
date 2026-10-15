// Fenêtre Paramètres (barre latérale) : Général (langue, thème), Workspaces (valeurs proposées à la
// création), Assistant IA. Préférences enregistrées dans le volume par cloudbox-api.
import { useState } from 'preact/hooks';
import { api, ENV_LABELS, ENVS, PANEL_KINDS, type CursorStyle, type Env, type PanelKind, type TerminalPrefs, type Theme } from './api';
import { AiSettingsForm } from './ai-settings';
import { useAssistantConfig } from './assistant';
import { getLang, LANGS, setLang, t } from './i18n';
import { Flag, Icon, type IconName } from './icons';
import { isDark, prefsStore, usePreferences, type PrefsTab } from './prefs';

const TABS: readonly PrefsTab[] = ['general', 'workspaces', 'terminal', 'ai'];
const TAB_KEY = 'cloudbox.settings.tab';
const TAB_ICONS: Record<PrefsTab, IconName> = { general: 'gear', workspaces: 'folder', terminal: 'terminal', ai: 'sparkle' };

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

export const PANEL_LABELS: Record<PanelKind, string> = { pwsh: 'PowerShell', bash: 'Bash', code: 'VS Code', assistant: 'Assistant' };
export const PANEL_ICONS: Record<PanelKind, IconName> = { pwsh: 'pwsh', bash: 'bash', code: 'code', assistant: 'sparkle' };

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
          <label key={kind} class={`panel-option kind-${kind}${value.includes(kind) && !off ? ' selected' : ''}${off ? ' disabled' : ''}`}>
            <input type="checkbox" name={name} checked={value.includes(kind) && !off} disabled={off}
              onChange={(e) => toggle(kind, e.currentTarget.checked)} />
            <Icon name={PANEL_ICONS[kind]} size={18} />
            {PANEL_LABELS[kind]}
            {off && <span class="muted"> ({m.assistantOff})</span>}
          </label>
        );
      })}
    </div>
  );
}

// Bloc d'un onglet : carré d'icône, titre, aide, puis les réglages
function PrefBlock({ icon, title, help, children }: { icon: IconName; title: string; help?: string; children: preact.ComponentChildren }) {
  return (
    <section class="pref-block">
      <span class="icon-tile"><Icon name={icon} size={22} /></span>
      <div class="pref-block-body">
        <h3>{title}</h3>
        {help && <p class="pref-help">{help}</p>}
        {children}
      </div>
    </section>
  );
}

const THEME_ICONS: Record<Theme, IconName> = { auto: 'monitor', light: 'sun', dark: 'moon' };

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
      <PrefBlock icon="globe" title={m.language} help={m.languageHelp}>
        <fieldset class="seg-choice" aria-label={m.language}>
          {LANGS.map((l) => (
            <label key={l} class={getLang() === l ? 'selected' : ''} lang={l}>
              <input type="radio" name="prefs-lang" checked={getLang() === l} onChange={() => setLang(l)} />
              <Flag lang={l} />
              {l === 'fr' ? 'Français' : 'English'}
            </label>
          ))}
        </fieldset>
      </PrefBlock>
      <PrefBlock icon="palette" title={m.theme} help={m.themeIntro}>
        <fieldset class="seg-choice" aria-label={m.theme}>
          {(['auto', 'light', 'dark'] as const).map((th) => (
            <label key={th} class={(prefs?.theme ?? 'auto') === th ? 'selected' : ''}>
              <input type="radio" name="prefs-theme" checked={(prefs?.theme ?? 'auto') === th} disabled={!prefs}
                onChange={() => setTheme(th)} />
              <Icon name={THEME_ICONS[th]} size={18} />
              {m.themes[th]}
            </label>
          ))}
        </fieldset>
        <p class="field-help">{m.themeHelp}</p>
      </PrefBlock>
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
      <PrefBlock icon="layers" title={m.defaultEnv} help={m.newWorkspaceHelp}>
        <fieldset class="env-choice" aria-label={m.defaultEnv}>
          {ENVS.map((value) => (
            <label class={`env-option env-${value}${currentEnv === value ? ' selected' : ''}`} key={value}>
              <input type="radio" name="prefs-env" value={value} checked={currentEnv === value} onChange={() => setEnv(value)} />
              <Icon name="cube" size={18} />
              {ENV_LABELS[value]}
            </label>
          ))}
        </fieldset>
        {currentEnv === 'prd' && <p class="warn">{m.prdWarning}</p>}
      </PrefBlock>
      <PrefBlock icon="grid" title={m.panels}>
        <fieldset aria-label={m.panels}>
          <PanelChoice name="prefs-panels" value={currentPanels} onChange={setPanels} />
        </fieldset>
      </PrefBlock>
      {error && <p class="error" role="alert">{error}</p>}
      {message && <p class="muted" role="status">{message}</p>}
      <div class="ws-actions">
        <button type="button" class="button primary" disabled={busy || !changed} onClick={save}>{t().common.save}</button>
      </div>
    </div>
  );
}

// Polices courantes des postes (Windows, macOS, Linux) ; le navigateur prend la première installée
const FONTS = ['Cascadia Mono', 'Consolas', 'Menlo', 'DejaVu Sans Mono', 'JetBrains Mono', 'Fira Code'];
const CURSORS: readonly CursorStyle[] = ['block', 'bar', 'underline'];
const FONT_SIZE = { min: 8, max: 32 };
// Couleurs de l'aperçu, reprises de la page des terminaux (ttyd-index-addon.html)
const PREVIEW_COLORS = {
  dark: { background: '#0b1729', foreground: '#d6deeb', cyan: '#4fd1d9', blue: '#5aa2ff', green: '#7fd962' },
  light: { background: '#ffffff', foreground: '#24292f', cyan: '#1b7c83', blue: '#0969da', green: '#116329' },
};

// Police d'une entrée de la liste : entre guillemets, avec repli à chasse fixe
function fontStack(name: string): string {
  return `'${name}', monospace`;
}

function TerminalTab() {
  const m = t().prefs.terminal;
  const prefs = usePreferences();
  const [draft, setDraft] = useState<TerminalPrefs | null>(null);
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  if (!prefs) return <p class="muted">{t().common.loading}</p>;
  const saved = prefs.terminal;
  const cur = draft ?? saved;
  const changed = JSON.stringify(cur) !== JSON.stringify(saved);
  const set = (patch: Partial<TerminalPrefs>) => {
    setMessage('');
    setDraft({ ...cur, ...patch });
  };
  const listed = FONTS.find((f) => cur.fontFamily === fontStack(f));
  const fontChoice = custom || (cur.fontFamily && !listed) ? 'custom' : listed ?? '';
  const size = (n: number) => set({ fontSize: Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, Math.round(n) || saved.fontSize)) });

  const save = async () => {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      prefsStore.set(await api.updatePreferences({ terminal: cur }));
      setDraft(null);
      setMessage(t().prefs.saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const dark = cur.theme === 'dark' || (cur.theme === 'auto' && isDark());
  const colors = PREVIEW_COLORS[dark ? 'dark' : 'light'];
  return (
    <div class="prefs-section terminal-prefs">
      <PrefBlock icon="text" title={m.font} help={m.help}>
        <label>
          <span class="sr-only">{m.font}</span>
          <select value={fontChoice} aria-label={m.font} onChange={(e) => {
            const v = e.currentTarget.value;
            setCustom(v === 'custom');
            if (v !== 'custom') set({ fontFamily: v ? fontStack(v) : '' });
          }}>
            <option value="">{m.fontDefault}</option>
            {FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: fontStack(f) }}>{f}</option>)}
            <option value="custom">{m.fontCustom}</option>
          </select>
        </label>
        {fontChoice === 'custom' && (
          <label>
            {m.fontCustomLabel}
            <input value={cur.fontFamily} maxLength={120} spellcheck={false} placeholder="'Hack Nerd Font', monospace"
              onInput={(e) => set({ fontFamily: e.currentTarget.value })} />
          </label>
        )}
        <p class="field-help">{m.fontHelp}</p>
        <div class="terminal-size">
          <label>
            {m.size}
            <span class="stepper">
              <button type="button" class="button small" aria-label={m.smaller} disabled={cur.fontSize <= FONT_SIZE.min}
                onClick={() => size(cur.fontSize - 1)}>−</button>
              <input type="number" min={FONT_SIZE.min} max={FONT_SIZE.max} step={1} value={cur.fontSize}
                onChange={(e) => size(Number(e.currentTarget.value))} />
              <button type="button" class="button small" aria-label={m.larger} disabled={cur.fontSize >= FONT_SIZE.max}
                onClick={() => size(cur.fontSize + 1)}>+</button>
            </span>
          </label>
          <label>
            {m.lineHeight}
            <select value={String(cur.lineHeight)} onChange={(e) => set({ lineHeight: Number(e.currentTarget.value) })}>
              {[1, 1.1, 1.2, 1.3, 1.5].map((v) => <option key={v} value={String(v)}>{v.toFixed(1)}</option>)}
              {![1, 1.1, 1.2, 1.3, 1.5].includes(cur.lineHeight) && <option value={String(cur.lineHeight)}>{cur.lineHeight}</option>}
            </select>
          </label>
        </div>
      </PrefBlock>
      <PrefBlock icon="terminal" title={m.cursor}>
        <fieldset class="seg-choice" aria-label={m.cursor}>
          {CURSORS.map((c) => (
            <label key={c} class={cur.cursorStyle === c ? 'selected' : ''}>
              <input type="radio" name="prefs-cursor" checked={cur.cursorStyle === c} onChange={() => set({ cursorStyle: c })} />
              {m.cursors[c]}
            </label>
          ))}
        </fieldset>
        <label class="check">
          <input type="checkbox" checked={cur.cursorBlink} onChange={(e) => set({ cursorBlink: e.currentTarget.checked })} />
          {m.cursorBlink}
        </label>
      </PrefBlock>
      <PrefBlock icon="palette" title={m.theme}>
        <fieldset class="seg-choice" aria-label={m.theme}>
          {(['auto', 'light', 'dark'] as const).map((th: Theme) => (
            <label key={th} class={cur.theme === th ? 'selected' : ''}>
              <input type="radio" name="prefs-term-theme" checked={cur.theme === th} onChange={() => set({ theme: th })} />
              <Icon name={THEME_ICONS[th]} size={18} />
              {m.themes[th]}
            </label>
          ))}
        </fieldset>
      </PrefBlock>
      <PrefBlock icon="folder" title={m.pathBarTitle}>
        <label class="check">
          <input type="checkbox" checked={cur.pathBar} onChange={(e) => set({ pathBar: e.currentTarget.checked })} />
          {m.pathBar}
        </label>
      </PrefBlock>
      <div class="terminal-preview" aria-label={m.preview} style={{
        fontFamily: cur.fontFamily ? cur.fontFamily : 'Consolas, "Liberation Mono", Menlo, Courier, monospace',
        fontSize: `${cur.fontSize}px`, lineHeight: cur.lineHeight, background: colors.background, color: colors.foreground,
      }}>
        <div><span style={{ color: colors.cyan }}>dev@cloudbox</span> <span style={{ color: colors.blue }}>~/workspaces/demo</span></div>
        <div><span style={{ color: colors.green }}>PS&gt;</span> Get-AzContext<span class={`preview-cursor ${cur.cursorStyle}`} style={{ borderColor: colors.foreground }} /></div>
      </div>
      {error && <p class="error" role="alert">{error}</p>}
      {message && <p class="muted" role="status">{message}</p>}
      <div class="ws-actions">
        <button type="button" class="button primary" disabled={busy || !changed} onClick={save}>{t().common.save}</button>
        {changed && <button type="button" class="button ghost" disabled={busy} onClick={() => { setDraft(null); setCustom(false); }}>{t().common.cancel}</button>}
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
      <div class="dialog-head">
        <span class="icon-tile large"><Icon name="gear" size={30} /></span>
        <div>
          <h2>{m.title}</h2>
          <p>{m.subtitle}</p>
        </div>
      </div>
      <div class="prefs-body">
        <div class="prefs-tabs" role="tablist" aria-orientation="vertical">
          {TABS.map((id) => (
            <button type="button" role="tab" key={id} id={`prefs-tab-${id}`} aria-selected={tab === id}
              aria-controls="prefs-panel" class={tab === id ? 'active' : ''} onClick={() => select(id)}>
              <Icon name={TAB_ICONS[id]} size={20} />
              {m.tabs[id]}
            </button>
          ))}
        </div>
        <div class="prefs-panel" id="prefs-panel" role="tabpanel" aria-labelledby={`prefs-tab-${tab}`}>
          {tab === 'general' && <General />}
          {tab === 'workspaces' && <Workspaces />}
          {tab === 'terminal' && <TerminalTab />}
          {tab === 'ai' && <AiSettingsForm />}
        </div>
      </div>
    </div>
  );
}
