// Connexion : le jeton part dans un en-tête Authorization, Caddy répond par un cookie de session.
import './styles.css';

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
