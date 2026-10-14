// Faux fournisseur compatible OpenAI, pour les tests (unitaires et test de fumée de l'image).
//   node fake-provider.ts <port> [journal.jsonl]
// Scénario :
//  - message de l'utilisateur sans résultat d'outil : un texte, puis une proposition run_command
//    (« echo cloudbox-fake-ok », en pwsh, ou en bash si le message contient « [bash] ») ;
//  - dernier message = résultat d'outil : un texte qui reprend ce résultat ;
//  - message contenant « lis le terminal » : appel de read_terminal, puis réponse.
// Chaque requête reçue est ajoutée au journal (vérification du masquage des secrets).
import { appendFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';

function chunk(delta: unknown, finish: string | null = null): string {
  return `data: ${JSON.stringify({ id: 'fake', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
}

export function startFakeProvider(port: number, journal?: string): Promise<Server> {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    if (journal) appendFileSync(journal, JSON.stringify({ url: req.url, auth: req.headers.authorization ?? '', body: raw }) + '\n');
    if (req.method === 'GET' && req.url?.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'fake/model-b' }, { id: 'fake/model-a' }] }));
      return;
    }
    if (req.headers.authorization !== 'Bearer test-key-123456') {
      res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: 'bad key' } }));
      return;
    }
    const body = JSON.parse(raw);
    const messages = body.messages as { role: string; content: string | null }[];
    const last = messages[messages.length - 1];
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(': OPENROUTER PROCESSING\n\n');
    if (last.role === 'tool') {
      res.write(chunk({ role: 'assistant', content: 'Résultat : ' }));
      res.write(chunk({ content: String(last.content).split('\n').slice(0, 3).join(' | ') }));
      res.write(chunk({}, 'stop'));
    } else if (String(last.content).includes('lis le terminal')) {
      res.write(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_read', type: 'function', function: { name: 'read_terminal', arguments: '' } }] }));
      res.write(chunk({ tool_calls: [{ index: 0, function: { arguments: '{"lines": 50}' } }] }));
      res.write(chunk({}, 'tool_calls'));
    } else {
      res.write(chunk({ role: 'assistant', content: 'Je propose ' }));
      res.write(chunk({ content: 'une commande.' }));
      res.write(chunk({ tool_calls: [{ index: 0, id: 'call_run', type: 'function', function: { name: 'run_command', arguments: '{"command": "echo cloudbox-' } }] }));
      const shell = String(last.content).includes('[bash]') ? 'bash' : 'pwsh';
      res.write(chunk({ tool_calls: [{ index: 0, function: { arguments: `fake-ok", "shell": "${shell}", "reason": "test"}` } }] }));
      res.write(chunk({}, 'tool_calls'));
    }
    res.end('data: [DONE]\n\n');
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (import.meta.main) {
  const port = Number(process.argv[2] ?? 18080);
  await startFakeProvider(port, process.argv[3]);
  console.log(`faux fournisseur sur http://127.0.0.1:${port}/v1`);
}
