// Tests des connexions par workspace : mode (isolé par défaut), variables des terminaux, contexte réel
// lu dans le dossier du workspace et non dans la configuration commune.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const home = realpathSync(mkdtempSync(path.join(tmpdir(), 'cloudbox-home-')));
process.env.CLOUDBOX_HOME = home;
delete process.env.AZURE_CONFIG_DIR;
delete process.env.GH_CONFIG_DIR;
const { checkIdentities, cloudContext, identityDir, identityEnv, identityMode, sharedTools } = await import('../lib.ts');

function azureProfile(dir: string, name: string) {
  mkdirSync(dir, { recursive: true });
  const sub = { id: '00000000-0000-0000-0000-000000000001', name, tenantId: 't', isDefault: true, user: { name: 'u@x' }, environmentName: 'AzureCloud' };
  // BOM UTF-8, comme le fichier écrit par az
  writeFileSync(path.join(dir, 'azureProfile.json'), '﻿' + JSON.stringify({ subscriptions: [sub] }));
}

azureProfile(path.join(home, '.azure'), 'abonnement-commun');
azureProfile(path.join(home, '.cloudbox', 'identities', 'client-a', 'azure'), 'abonnement-a');

test('mode : isolé par défaut, partagé sur demande, valeur stricte', () => {
  assert.equal(identityMode({}), 'isolated');
  assert.equal(identityMode({ identities: 'shared' }), 'shared');
  assert.equal(checkIdentities('shared'), 'shared');
  assert.throws(() => checkIdentities('aucun'), { status: 400 });
  assert.throws(() => identityDir('../x'), { status: 400 });
});

test('variables : dossiers du workspace, kubeconfig en couches ; aucune en mode partagé', () => {
  const env = identityEnv({ id: 'client-a' });
  const dir = path.join(home, '.cloudbox', 'identities', 'client-a');
  assert.equal(env.AZURE_CONFIG_DIR, path.join(dir, 'azure'));
  assert.equal(env.AZURE_EXTENSION_DIR, path.join(home, '.azure', 'cliextensions'));
  assert.equal(env.AZD_CONFIG_DIR, path.join(dir, 'azd'));
  assert.equal(env.GH_CONFIG_DIR, path.join(dir, 'gh'));
  assert.equal(env.KUBECONFIG, `${path.join(dir, 'kube', 'config')}:${path.join(home, '.kube', 'config')}`);
  assert.deepEqual(identityEnv({ id: 'client-a', identities: 'shared' }), {});
  assert.deepEqual(sharedTools({}), ['azPowerShell']);
  assert.equal(sharedTools({ identities: 'shared' }).length, 4);
});

test('contexte : celui du workspace isolé, sinon la configuration commune', async () => {
  const base = { name: 'x', env: 'dev' as const, folder: home, nextPanel: 1, layout: null, created: '', updated: '' };
  const a = await cloudContext({ ...base, id: 'client-a' });
  assert.equal(a.azureCli?.subscription, 'abonnement-a');
  assert.equal(a.identities, 'isolated');
  assert.equal(a.sharedAcrossWorkspaces, false);
  // Workspace isolé jamais connecté : pas de repli sur la connexion commune
  const b = await cloudContext({ ...base, id: 'client-b' });
  assert.equal(b.azureCli, null);
  const shared = await cloudContext({ ...base, id: 'client-b', identities: 'shared' });
  assert.equal(shared.azureCli?.subscription, 'abonnement-commun');
  assert.equal(shared.sharedAcrossWorkspaces, true);
  const common = await cloudContext();
  assert.equal(common.azureCli?.subscription, 'abonnement-commun');
});
