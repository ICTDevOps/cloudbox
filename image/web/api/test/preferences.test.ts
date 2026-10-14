// Tests des préférences du portail : valeurs par défaut, mise à jour partielle, validation.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

process.env.CLOUDBOX_HOME = mkdtempSync(path.join(tmpdir(), 'cloudbox-home-'));
const { applyPreferences, checkPanels, defaultPreferences, loadPreferences } = await import('../lib.ts');
const { checkWorkspaceAssistant } = await import('../assistant/config.ts');

test('fichier absent : valeurs par défaut (disposition historique)', async () => {
  assert.deepEqual(await loadPreferences(), { theme: 'auto', newWorkspace: { env: 'dev', panels: ['pwsh', 'code', 'bash'] } });
});

test('mise à jour partielle', () => {
  const next = applyPreferences(defaultPreferences(), { newWorkspace: { panels: ['bash', 'assistant'] } });
  assert.deepEqual(next, { theme: 'auto', newWorkspace: { env: 'dev', panels: ['bash', 'assistant'] } });
  assert.equal(applyPreferences(next, { theme: 'dark' }).theme, 'dark');
});

test('valeurs refusées', () => {
  assert.throws(() => checkPanels([]), { status: 400 });
  assert.throws(() => checkPanels(['pwsh', 'pwsh']), { status: 400 });
  assert.throws(() => checkPanels(['zsh']), { status: 400 });
  assert.throws(() => applyPreferences(defaultPreferences(), { theme: 'pink' }), { status: 400 });
  assert.throws(() => applyPreferences(defaultPreferences(), { newWorkspace: { env: 'prod' } }), { status: 400 });
  assert.throws(() => applyPreferences(defaultPreferences(), { other: 1 }), { status: 400 });
});

test('modèle du workspace', () => {
  assert.equal(checkWorkspaceAssistant(null), null);
  assert.equal(checkWorkspaceAssistant({ provider: '', model: '' }), null);
  assert.deepEqual(checkWorkspaceAssistant({ provider: 'openrouter', model: 'vendor/model-1' }), { provider: 'openrouter', model: 'vendor/model-1' });
  assert.throws(() => checkWorkspaceAssistant({ provider: 'Open Router', model: 'x' }), { status: 400 });
  assert.throws(() => checkWorkspaceAssistant({ provider: 'openrouter' }), { status: 400 });
});
