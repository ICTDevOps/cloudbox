// Connexion : le jeton part dans un en-tête Authorization, Caddy répond par un cookie de session.
import { getLang, setLang, t, type Lang } from './i18n';
import './styles.css';

// Textes de la page dans la langue choisie (le HTML contient la version française)
function applyLang(): void {
  const m = t().login;
  document.title = m.title;
  const text: Record<string, string> = {
    'login-intro': m.intro,
    'login-label': m.label,
    'login-submit': m.submit,
    'login-error': m.invalid,
    'login-hint': m.hint,
  };
  for (const [id, value] of Object.entries(text)) document.getElementById(id)!.textContent = value;
  document.querySelectorAll<HTMLButtonElement>('#login-lang button').forEach((b) => {
    const active = b.dataset.lang === getLang();
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
}

document.querySelectorAll<HTMLButtonElement>('#login-lang button').forEach((b) => {
  b.addEventListener('click', () => {
    setLang(b.dataset.lang as Lang);
    applyLang();
  });
});
applyLang();

const form = document.getElementById('login-form') as HTMLFormElement;
const input = document.getElementById('token') as HTMLInputElement;
const error = document.getElementById('login-error') as HTMLElement;

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.hidden = true;
  try {
    const response = await fetch('/_auth/login', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + input.value.trim() },
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (response.status === 204) {
      // Recharge l'adresse demandée (/, /term/pwsh/, /code/…) avec la session
      window.location.reload();
      return;
    }
  } catch {
    // erreur réseau : même message
  }
  error.hidden = false;
  input.select();
});
