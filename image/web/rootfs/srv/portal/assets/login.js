// Connexion : le jeton part dans un en-tête Authorization, Caddy répond par un cookie de session.
'use strict';

document.getElementById('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.getElementById('token');
  const error = document.getElementById('login-error');
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
  } catch (e) {
    // erreur réseau : même message
  }
  error.hidden = false;
  input.select();
});
