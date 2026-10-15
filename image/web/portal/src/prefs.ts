// Préférences du portail (thème, nouveau workspace, terminal), lues et écrites par cloudbox-api.
// Le thème est aussi gardé dans localStorage : appliqué avant le premier rendu, sans flash.
// Les préférences du terminal aussi (« cloudbox.terminal ») : la page ttyd de chaque terminal les lit
// au chargement et suit leurs changements (événement « storage », reçu par les autres pages).
import { useEffect, useState } from 'preact/hooks';
import { api, type Preferences, type Theme } from './api';

const THEME_KEY = 'cloudbox.theme';
const TERMINAL_KEY = 'cloudbox.terminal';
const dark = window.matchMedia('(prefers-color-scheme: dark)');

let prefs: Preferences | null = null;
const listeners = new Set<() => void>();
const themeListeners = new Set<() => void>();
let theme: Theme = readCachedTheme();

function readCachedTheme(): Theme {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

// « auto » : pas d'attribut, la feuille de style suit le système
export function applyTheme(next: Theme): void {
  theme = next;
  if (next === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', next);
  try {
    window.localStorage.setItem(THEME_KEY, next);
  } catch {
    // stockage indisponible : thème réappliqué au chargement des préférences
  }
  themeListeners.forEach((l) => l());
}

// Thème effectif (pour les composants qui ne suivent pas les variables CSS, comme Dockview)
export function isDark(): boolean {
  return theme === 'dark' || (theme === 'auto' && dark.matches);
}

export function onThemeChange(listener: () => void): () => void {
  themeListeners.add(listener);
  const media = () => theme === 'auto' && listener();
  dark.addEventListener('change', media);
  return () => {
    themeListeners.delete(listener);
    dark.removeEventListener('change', media);
  };
}

function cacheTerminal(next: Preferences): void {
  try {
    window.localStorage.setItem(TERMINAL_KEY, JSON.stringify(next.terminal));
  } catch {
    // stockage indisponible : les terminaux lisent /api/preferences à leur chargement
  }
}

export type PrefsTab = 'general' | 'workspaces' | 'terminal' | 'ai';

// Ouvre la fenêtre Paramètres (barre latérale), éventuellement sur un onglet
export const OPEN_SETTINGS_EVENT = 'cloudbox:open-settings';
export function openSettings(tab?: PrefsTab): void {
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail: tab }));
}

export const prefsStore = {
  get: () => prefs,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  async reload(): Promise<void> {
    try {
      prefs = await api.preferences();
      if (prefs.theme !== theme) applyTheme(prefs.theme);
      cacheTerminal(prefs);
    } catch {
      // API indisponible : valeurs par défaut côté formulaire
    }
    listeners.forEach((l) => l());
  },
  set(next: Preferences): void {
    prefs = next;
    if (next.theme !== theme) applyTheme(next.theme);
    cacheTerminal(next);
    listeners.forEach((l) => l());
  },
};

export function usePreferences(): Preferences | null {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const l = () => setVersion((v) => v + 1);
    listeners.add(l);
    if (!prefs) prefsStore.reload();
    return () => void listeners.delete(l);
  }, []);
  return prefs;
}

applyTheme(theme);
