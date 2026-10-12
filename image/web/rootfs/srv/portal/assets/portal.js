// Portail : versions des outils (versions.json produit au build par cloudbox-versions)
// et boutons de copie de l'aide-mémoire.
'use strict';

async function loadVersions() {
  const meta = document.getElementById('versions-meta');
  const tbody = document.querySelector('#versions tbody');
  try {
    const response = await fetch('/versions.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(response.status);
    const data = await response.json();
    let category = null;
    for (const tool of data.tools) {
      if (tool.category !== category) {
        category = tool.category;
        const row = tbody.insertRow();
        row.className = 'category';
        const cell = row.insertCell();
        cell.colSpan = 3;
        cell.textContent = category;
      }
      const row = tbody.insertRow();
      row.insertCell().textContent = tool.name;
      const cmd = row.insertCell();
      const code = document.createElement('code');
      code.textContent = tool.command;
      cmd.appendChild(code);
      const version = row.insertCell();
      version.textContent = tool.version || 'non disponible';
      if (!tool.version) version.className = 'error';
    }
    const date = new Date(data.generated);
    meta.textContent = `Image construite le ${date.toLocaleDateString('fr-FR')} (${data.arch}).`;
  } catch (e) {
    meta.textContent = 'Versions indisponibles.';
  }
}

function addCopyButtons() {
  for (const dd of document.querySelectorAll('.cheatsheet dd')) {
    const code = dd.querySelector('code');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy';
    button.textContent = 'Copier';
    button.setAttribute('aria-label', 'Copier : ' + code.textContent);
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code.textContent);
        button.textContent = 'Copié';
      } catch (e) {
        button.textContent = 'Échec';
      }
      setTimeout(() => { button.textContent = 'Copier'; }, 1500);
    });
    dd.appendChild(button);
  }
}

loadVersions();
addCopyButtons();
