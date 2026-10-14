// Tests des outils de lecture : confinement au dossier du workspace, fichiers cachés du home refusés.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// HOME de test, fixé avant le chargement de lib.ts
const home = mkdtempSync(path.join(tmpdir(), 'cloudbox-home-'));
process.env.CLOUDBOX_HOME = home;
const { runReadTool } = await import('../assistant/tools.ts');

mkdirSync(path.join(home, '.cloudbox'), { recursive: true });
writeFileSync(path.join(home, '.cloudbox', 'token'), 'f'.repeat(64));
mkdirSync(path.join(home, 'workspaces', 'client', '.terraform'), { recursive: true });
writeFileSync(path.join(home, 'workspaces', 'client', 'main.tf'), 'password = "Sup3rSecret99"\n');
writeFileSync(path.join(home, 'workspaces', 'client', '.terraform', 'state'), 'ok');
symlinkSync('/etc', path.join(home, 'workspaces', 'client', 'etc'));

const ws = (folder: string) => ({
  id: 'client', name: 'Client', env: 'dev' as const, folder, nextPanel: 1, layout: null, created: '', updated: '',
});
const ctx = (folder: string) => ({ ws: ws(folder), activeSession: null });
const client = path.join(home, 'workspaces', 'client');

test('fichier du workspace lu, secret masqué', async () => {
  assert.equal(await runReadTool('read_file', { path: 'main.tf' }, ctx(client)), 'password = "[masqué]"\n');
});

test('dossier caché du workspace lisible (.terraform)', async () => {
  assert.equal(await runReadTool('read_file', { path: '.terraform/state' }, ctx(client)), 'ok');
});

test('sortie du dossier refusée (.., lien symbolique, chemin absolu)', async () => {
  for (const p of ['../../.cloudbox/token', 'etc/passwd', '/etc/passwd']) {
    assert.match(await runReadTool('read_file', { path: p }, ctx(client)), /^Erreur : chemin hors du dossier/, p);
  }
});

test('workspace sur /home/dev : dossiers cachés du home refusés', async () => {
  const out = await runReadTool('read_file', { path: '.cloudbox/token' }, ctx(home));
  assert.match(out, /^Erreur : fichier de configuration du home/);
  assert.match(await runReadTool('list_files', { path: '.cloudbox' }, ctx(home)), /^Erreur : fichier de configuration du home/);
  assert.match(await runReadTool('list_files', {}, ctx(home)), /workspaces\//);
});
