// Tests du masquage des secrets (node --test test/).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redact, redactText } from '../assistant/redact.ts';

const masked = (input: string) => redactText(input);

test('JWT', () => {
  const jwt = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiJodHRwczovL21hbmFnZW1lbnQuYXp1cmUuY29tIn0.c2lnbmF0dXJlLXNpZ25hdHVyZQ';
  assert.equal(masked(`token: ${jwt}`).includes(jwt), false);
});

test('en-tête Authorization et Bearer', () => {
  assert.equal(masked('Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123'), 'Authorization: Bearer [masqué]');
  assert.equal(masked('curl -H "Bearer abcdefghijklmnopqrstuvwxyz0123"'), 'curl -H "Bearer [masqué]"');
});

test('chaîne de connexion Azure Storage', () => {
  const out = masked('DefaultEndpointsProtocol=https;AccountName=stcontoso;AccountKey=Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4==;EndpointSuffix=core.windows.net');
  assert.match(out, /AccountName=stcontoso;AccountKey=\[masqué\];EndpointSuffix/);
});

test('jeton SAS', () => {
  const out = masked('https://st.blob.core.windows.net/c/f?sv=2022-11-02&se=2026-01-01&sp=r&sig=abc%2Bdef%3D');
  assert.match(out, /&sig=\[masqué\]$/);
  assert.match(out, /sv=2022-11-02/);
});

test('clé de stockage seule (az storage account keys list)', () => {
  const key = 'A'.repeat(86) + '==';
  assert.equal(masked(`"value": "${key}"`), '"value": "[masqué]"');
});

test('affectations de secrets', () => {
  assert.equal(masked('password=Sup3rS3cret!'), 'password=[masqué]');
  assert.equal(masked('"clientSecret": "abcd1234efgh"'), '"clientSecret": "[masqué]"');
  assert.equal(masked('Server=tcp:x;User ID=sa;Pwd=hunter22;'), 'Server=tcp:x;User ID=sa;Pwd=[masqué];');
  // Valeurs courtes ou mots ordinaires : laissés tels quels
  assert.equal(masked('Le mot password est ici'), 'Le mot password est ici');
});

test('paramètres PowerShell', () => {
  assert.equal(masked('New-Thing -ClientSecret s3cr3tvalue -Name x'), 'New-Thing -ClientSecret [masqué] -Name x');
  // Variable : ce n'est pas le secret lui-même
  assert.equal(masked('-ClientSecret $secret'), '-ClientSecret $secret');
});

test('secret client Entra ID', () => {
  const secret = 'abc8Q~' + 'x'.repeat(34);
  assert.equal(masked(`secret ${secret} fin`), 'secret [masqué] fin');
});

test('clé privée PEM', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nIBAAK\n-----END RSA PRIVATE KEY-----';
  assert.equal(masked(`a\n${pem}\nb`), 'a\n-----BEGIN PRIVATE KEY-----[masqué]-----END PRIVATE KEY-----\nb');
});

test('clés de fournisseurs et jetons GitHub', () => {
  assert.equal(masked('sk-or-v1-0123456789abcdef0123456789'), '[masqué]');
  assert.equal(masked('sk-ant-api03-0123456789abcdefghijkl'), '[masqué]');
  assert.equal(masked('ghp_' + 'a'.repeat(36)), '[masqué]');
});

test('code de connexion device code', () => {
  const out = masked('To sign in, use a web browser to open the page https://microsoft.com/devicelogin and enter the code ABCD1234E to authenticate.');
  assert.match(out, /enter the code \[masqué\] to authenticate/);
});

test('texte ordinaire inchangé, compteurs', () => {
  const text = 'az group list -o table\nName  Location\nrg-app  westeurope';
  const r = redact(text);
  assert.equal(r.text, text);
  assert.deepEqual(r.counts, {});
  assert.equal(redact('password=abcdefgh').counts.assignment, 1);
});

test('valeurs exactes connues (jeton Cloudbox, clés API)', async () => {
  const { setKnownSecrets } = await import('../assistant/redact.ts');
  const token = 'a3f9'.repeat(16);
  setKnownSecrets([token, 'my-gateway-key-42', undefined, 'court']);
  assert.equal(masked(`cat ~/.cloudbox/token\n${token}`), 'cat ~/.cloudbox/token\n[masqué]');
  assert.equal(masked('x my-gateway-key-42 y'), 'x [masqué] y');
  assert.equal(masked('court'), 'court'); // moins de 8 caractères : ignoré
  setKnownSecrets([]);
});
