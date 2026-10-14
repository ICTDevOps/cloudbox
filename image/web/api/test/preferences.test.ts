// Tests des préférences du portail : valeurs par défaut, mise à jour partielle, validation.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

process.env.CLOUDBOX_HOME = mkdtempSync(path.join(tmpdir(), 'cloudbox-home-'));
const { applyPreferences, checkPanels, defaultPreferences, defaultTerminal, loadPreferences, PREFERENCES_FILE } = await import('../lib.ts');
const { mkdirSync, writeFileSync } = await import('node:fs');
const { checkWorkspaceAssistant } = await import('../assistant/config.ts');

test('fichier absent : valeurs par défaut (disposition historique)', async () => {
  assert.deepEqual(await loadPreferences(), defaultPreferences());
  assert.deepEqual(defaultPreferences().newWorkspace, { env: 'dev', panels: ['pwsh', 'code', 'bash'] });
});

test('mise à jour partielle', () => {
  const next = applyPreferences(defaultPreferences(), { newWorkspace: { panels: ['bash', 'assistant'] } });
  assert.deepEqual(next, { theme: 'auto', newWorkspace: { env: 'dev', panels: ['bash', 'assistant'] }, terminal: defaultTerminal() });
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

test('terminal : mise à jour partielle', () => {
  const next = applyPreferences(defaultPreferences(), { terminal: { fontSize: 18, fontFamily: "'Cascadia Mono', monospace" } });
  assert.equal(next.terminal.fontSize, 18);
  assert.equal(next.terminal.fontFamily, "'Cascadia Mono', monospace");
  assert.equal(next.terminal.cursorStyle, 'block');
  const again = applyPreferences(next, { terminal: { pathBar: false, theme: 'light', lineHeight: 1.25 } });
  assert.equal(again.terminal.fontSize, 18);
  assert.equal(again.terminal.pathBar, false);
  assert.equal(again.terminal.lineHeight, 1.25);
});

test('terminal : valeurs refusées', () => {
  const bad = (terminal: unknown) => assert.throws(() => applyPreferences(defaultPreferences(), { terminal }), { status: 400 });
  bad({ fontSize: 99 });
  bad({ fontSize: 13.5 });
  bad({ fontFamily: 'Mono; } body { color: red' });
  bad({ fontFamily: 'x'.repeat(121) });
  bad({ lineHeight: 3 });
  bad({ cursorStyle: 'beam' });
  bad({ cursorBlink: 'yes' });
  bad({ toString: 1 });
  bad({ other: 1 });
  bad('large');
});

test('terminal : fichier ancien ou modifié à la main', async () => {
  mkdirSync(path.dirname(PREFERENCES_FILE), { recursive: true });
  writeFileSync(PREFERENCES_FILE, JSON.stringify({ theme: 'dark', terminal: { fontSize: 200, cursorStyle: 'bar' } }));
  const prefs = await loadPreferences();
  assert.equal(prefs.theme, 'dark');
  assert.equal(prefs.terminal.fontSize, 14);
  assert.equal(prefs.terminal.cursorStyle, 'bar');
});
