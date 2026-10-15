// Tests des connexions affichées dans le portail : celles publiées par un terminal PowerShell (option
// tmux @cloudbox_conn) et celle de CLI for Microsoft 365 (fichier commun, jetons jamais renvoyés).
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const home = realpathSync(mkdtempSync(path.join(tmpdir(), 'cloudbox-home-')));
process.env.CLOUDBOX_HOME = home;
const { m365Context, parseConnections } = await import('../lib.ts');

test('terminal : services et champs connus seulement, texte court', () => {
  const raw = JSON.stringify({
    graph: { user: 'admin@contoso.com', tenantId: 't', token: 'secret' },
    exo: { user: 'admin@contoso.com' },
    pnp: { url: 'https://contoso.sharepoint.com' },
    azps: { user: 'x'.repeat(500), subscription: 'Sub' },
    inconnu: { user: 'y' },
    teams: 'pas un objet',
  });
  const c = parseConnections(raw);
  assert.deepEqual(Object.keys(c).sort(), ['azps', 'exo', 'graph', 'pnp']);
  assert.deepEqual(c.graph, { user: 'admin@contoso.com', tenantId: 't' });
  assert.equal(c.azps?.user?.length, 200);
  assert.deepEqual(parseConnections('{'), {});
  assert.deepEqual(parseConnections('[]'), {});
});

test('CLI for Microsoft 365 : connexion active, sans les jetons', async () => {
  const file = path.join(home, '.cli-m365-connection.json');
  assert.equal(await m365Context(), null);
  writeFileSync(file, JSON.stringify({
    active: true, identityName: 'admin@contoso.com', identityTenantId: 't', cloudType: 'Public',
    accessTokens: { 'https://graph.microsoft.com': { accessToken: 'secret' } },
  }));
  assert.deepEqual(await m365Context(), { user: 'admin@contoso.com', tenantId: 't', cloud: 'Public' });
  writeFileSync(file, JSON.stringify({ active: false }));
  assert.equal(await m365Context(), null);
  // m365 logout vide le fichier
  writeFileSync(file, '');
  assert.equal(await m365Context(), null);
});
