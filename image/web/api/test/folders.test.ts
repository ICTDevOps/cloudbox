// Tests du sélecteur de dossiers : sous-dossiers de /home/dev seulement, sans les dossiers cachés.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const home = realpathSync(mkdtempSync(path.join(tmpdir(), 'cloudbox-home-')));
process.env.CLOUDBOX_HOME = home;
const { listFolders } = await import('../lib.ts');

mkdirSync(path.join(home, 'workspaces', 'client'), { recursive: true });
mkdirSync(path.join(home, 'b-projets'));
mkdirSync(path.join(home, '.azure'));
writeFileSync(path.join(home, 'notes.txt'), 'x');
symlinkSync('/etc', path.join(home, 'etc-link'));
symlinkSync(path.join(home, 'workspaces'), path.join(home, 'ws-link'));

test('racine : dossiers visibles, triés, sans cachés ni liens vers l’extérieur', async () => {
  const list = await listFolders(undefined);
  assert.equal(list.path, home);
  assert.equal(list.parent, null);
  assert.deepEqual(list.folders, ['b-projets', 'workspaces', 'ws-link']);
});

test('sous-dossier : parent renseigné', async () => {
  const list = await listFolders(path.join(home, 'workspaces'));
  assert.deepEqual(list.folders, ['client']);
  assert.equal(list.parent, home);
});

test('refus : hors de /home/dev, lien sortant, absent', async () => {
  await assert.rejects(listFolders('/etc'), { status: 400 });
  await assert.rejects(listFolders(path.join(home, '..')), { status: 400 });
  await assert.rejects(listFolders(path.join(home, 'etc-link')), { status: 400 });
  await assert.rejects(listFolders(path.join(home, 'absent')), { status: 404 });
  await assert.rejects(listFolders('a\nb'), { status: 400 });
});
