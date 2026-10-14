// Tests des adaptateurs (compatible OpenAI, Anthropic) contre des serveurs locaux.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, test } from 'node:test';
import { chat, listModels, ProviderError, type ChatMessage } from '../assistant/providers.ts';
import { startFakeProvider } from './fake-provider.ts';

const fake = await startFakeProvider(0);
const port = (fake.address() as { port: number }).port;
const openai = { id: 'fake', type: 'openai-compatible' as const, baseUrl: `http://127.0.0.1:${port}/v1`, auth: 'bearer' as const, apiKey: 'test-key-123456' };
after(() => fake.close());

const signal = new AbortController().signal;

test('compatible OpenAI : texte puis appel d\'outil en morceaux', async () => {
  let streamed = '';
  const r = await chat({ provider: openai, model: 'm', system: 's', messages: [{ role: 'user', text: 'bonjour' }], tools: [], signal, onText: (t) => (streamed += t) });
  assert.equal(r.text, 'Je propose une commande.');
  assert.equal(streamed, r.text);
  assert.deepEqual(r.toolCalls, [{ id: 'call_run', name: 'run_command', args: { command: 'echo cloudbox-fake-ok', shell: 'pwsh', reason: 'test' } }]);
  assert.equal(r.stop, 'tool_calls');
});

test('compatible OpenAI : résultat d\'outil renvoyé', async () => {
  const messages: ChatMessage[] = [
    { role: 'user', text: 'bonjour' },
    { role: 'assistant', text: '', toolCalls: [{ id: 'call_run', name: 'run_command', args: {} }] },
    { role: 'tool', callId: 'call_run', name: 'run_command', content: 'ligne 1\nligne 2' },
  ];
  const r = await chat({ provider: openai, model: 'm', system: 's', messages, tools: [], signal, onText: () => undefined });
  assert.equal(r.text, 'Résultat : ligne 1 | ligne 2');
  assert.equal(r.toolCalls.length, 0);
});

test('compatible OpenAI : mauvaise clé → ProviderError 401', async () => {
  await assert.rejects(
    chat({ provider: { ...openai, apiKey: 'nope-nope' }, model: 'm', system: 's', messages: [{ role: 'user', text: 'x' }], tools: [], signal, onText: () => undefined }),
    (err: unknown) => err instanceof ProviderError && err.status === 401 && err.message === 'bad key',
  );
});

test('liste des modèles triée', async () => {
  assert.deepEqual(await listModels(openai), ['fake/model-a', 'fake/model-b']);
});

test('Anthropic : événements text_delta, tool_use, input_json_delta', async () => {
  let request: any = null;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    request = { headers: req.headers, url: req.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
    const ev = (type: string, data: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    ev('message_start', { type: 'message_start', message: { id: 'msg', content: [] } });
    ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    ev('ping', { type: 'ping' });
    ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Je lis.' } });
    ev('content_block_stop', { type: 'content_block_stop', index: 0 });
    ev('content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: {} } });
    ev('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '' } });
    ev('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":' } });
    ev('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: ' "main.tf"}' } });
    ev('content_block_stop', { type: 'content_block_stop', index: 1 });
    ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' } });
    ev('message_stop', { type: 'message_stop' });
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const p = { id: 'anthropic', type: 'anthropic' as const, baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, apiKey: 'k-123456789' };
  const messages: ChatMessage[] = [
    { role: 'user', text: 'a' },
    { role: 'assistant', text: 'b', toolCalls: [{ id: 't1', name: 'get_context', args: {} }] },
    { role: 'tool', callId: 't1', name: 'get_context', content: '{}' },
    { role: 'user', text: 'c' },
  ];
  const r = await chat({ provider: p, model: 'claude-x', system: 'sys', messages, tools: [{ name: 'read_file', description: 'd', parameters: { type: 'object' } }], signal, onText: () => undefined });
  server.close();
  assert.equal(r.text, 'Je lis.');
  assert.deepEqual(r.toolCalls, [{ id: 'toolu_1', name: 'read_file', args: { path: 'main.tf' } }]);
  assert.equal(r.stop, 'tool_use');
  assert.equal(request.url, '/v1/messages');
  assert.equal(request.headers['x-api-key'], 'k-123456789');
  assert.equal(request.headers['anthropic-version'], '2023-06-01');
  assert.equal(request.body.system, 'sys');
  assert.deepEqual(request.body.tools[0], { name: 'read_file', description: 'd', input_schema: { type: 'object' } });
  // Alternance : le résultat d'outil et le message suivant forment un seul message « user »
  assert.deepEqual(request.body.messages.map((m: any) => m.role), ['user', 'assistant', 'user']);
  assert.deepEqual(request.body.messages[2].content, [
    { type: 'tool_result', tool_use_id: 't1', content: '{}' },
    { type: 'text', text: 'c' },
  ]);
});
