// Adaptateurs des fournisseurs d'IA, sans dépendance (fetch de Node), en streaming (SSE) :
//  - « openai-compatible » : /chat/completions (OpenRouter, OpenAI, Azure OpenAI v1, passerelles) ;
//  - « anthropic » : Messages API (/messages, anthropic-version 2023-06-01).
//
// La conversation est tenue dans un format neutre (ChatMessage) et convertie à chaque appel : on peut
// changer de fournisseur au milieu d'une conversation.

import type { ProviderConfig } from './config.ts';

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type ChatMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; callId: string; name: string; content: string };

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // schéma JSON des arguments
}

export interface ChatRequest {
  provider: ProviderConfig & { apiKey: string };
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  signal: AbortSignal;
  onText: (text: string) => void;
}

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  stop: string;
}

export class ProviderError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const REQUEST_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_TOKENS = 4096;
const ANTHROPIC_VERSION = '2023-06-01';

// --- SSE ---

interface SseEvent {
  event: string;
  data: string;
}

async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buffer = '';
  let event = '';
  let data: string[] = [];
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      if (line === '') {
        if (data.length) yield { event, data: data.join('\n') };
        event = '';
        data = [];
      } else if (line.startsWith(':')) {
        // commentaire (maintien de connexion, « : OPENROUTER PROCESSING »)
      } else if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data.push(line.slice(5).replace(/^ /, ''));
      }
    }
  }
  if (data.length) yield { event, data: data.join('\n') };
}

function parseArgs(json: string): Record<string, unknown> {
  if (!json.trim()) return {};
  try {
    const v = JSON.parse(json);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? v : {};
  } catch {
    return { _invalid: json.slice(0, 2000) };
  }
}

async function failure(response: Response): Promise<ProviderError> {
  let message = `HTTP ${response.status}`;
  try {
    const text = await response.text();
    try {
      const body = JSON.parse(text);
      message = String(body?.error?.message ?? body?.message ?? text).slice(0, 500);
    } catch {
      message = text.slice(0, 500) || message;
    }
  } catch {
    // corps illisible
  }
  return new ProviderError(response.status, message);
}

function headersFor(p: ProviderConfig & { apiKey: string }): Record<string, string> {
  if (p.type === 'anthropic') return { 'x-api-key': p.apiKey, 'anthropic-version': ANTHROPIC_VERSION };
  return p.auth === 'api-key' ? { 'api-key': p.apiKey } : { Authorization: `Bearer ${p.apiKey}` };
}

async function post(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal): Promise<Response> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
  });
  if (!response.ok || !response.body) throw await failure(response);
  return response;
}

// --- Compatible OpenAI ---

function toOpenAi(system: string, messages: ChatMessage[]): unknown[] {
  const out: unknown[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.text });
    else if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.callId, content: m.content });
    else {
      out.push({
        role: 'assistant',
        content: m.text || null,
        ...(m.toolCalls?.length
          ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
          : {}),
      });
    }
  }
  return out;
}

async function chatOpenAi(req: ChatRequest): Promise<ChatResult> {
  const response = await post(
    `${req.provider.baseUrl}/chat/completions`,
    headersFor(req.provider),
    {
      model: req.model,
      messages: toOpenAi(req.system, req.messages),
      tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
      stream: true,
    },
    req.signal,
  );
  let text = '';
  let stop = '';
  const calls = new Map<number, { id: string; name: string; args: string }>();
  for await (const ev of readSse(response.body!)) {
    if (ev.data === '[DONE]') break;
    let chunk: any;
    try {
      chunk = JSON.parse(ev.data);
    } catch {
      continue;
    }
    // Erreur en cours de flux (OpenRouter : statut 200, objet « error » au premier niveau)
    if (chunk?.error) throw new ProviderError(502, String(chunk.error.message ?? 'erreur du fournisseur').slice(0, 500));
    const choice = chunk?.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta ?? {};
    if (typeof delta.content === 'string' && delta.content) {
      text += delta.content;
      req.onText(delta.content);
    }
    for (const tc of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
      const index = typeof tc.index === 'number' ? tc.index : 0;
      const call = calls.get(index) ?? { id: '', name: '', args: '' };
      if (tc.id) call.id = tc.id;
      if (tc.function?.name) call.name += tc.function.name;
      if (typeof tc.function?.arguments === 'string') call.args += tc.function.arguments;
      calls.set(index, call);
    }
    if (choice.finish_reason) stop = choice.finish_reason;
  }
  const toolCalls = [...calls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([i, c]) => ({ id: c.id || `call_${Date.now()}_${i}`, name: c.name, args: parseArgs(c.args) }));
  return { text, toolCalls, stop: stop || (toolCalls.length ? 'tool_calls' : 'stop') };
}

// --- Anthropic ---

function toAnthropic(messages: ChatMessage[]): unknown[] {
  // Les résultats d'outils et les messages de l'utilisateur qui se suivent forment un seul message
  // « user » (alternance user / assistant)
  const out: { role: 'user' | 'assistant'; content: unknown[] }[] = [];
  const push = (role: 'user' | 'assistant', block: unknown) => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(block);
    else out.push({ role, content: [block] });
  };
  for (const m of messages) {
    if (m.role === 'user') push('user', { type: 'text', text: m.text });
    else if (m.role === 'tool') push('user', { type: 'tool_result', tool_use_id: m.callId, content: m.content });
    else {
      if (m.text) push('assistant', { type: 'text', text: m.text });
      for (const c of m.toolCalls ?? []) push('assistant', { type: 'tool_use', id: c.id, name: c.name, input: c.args });
      if (!m.text && !m.toolCalls?.length) push('assistant', { type: 'text', text: '…' });
    }
  }
  return out;
}

async function chatAnthropic(req: ChatRequest): Promise<ChatResult> {
  const response = await post(
    `${req.provider.baseUrl}/messages`,
    headersFor(req.provider),
    {
      model: req.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: req.system,
      messages: toAnthropic(req.messages),
      tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
      stream: true,
    },
    req.signal,
  );
  let text = '';
  let stop = '';
  const blocks = new Map<number, { id: string; name: string; json: string }>();
  for await (const ev of readSse(response.body!)) {
    let data: any;
    try {
      data = JSON.parse(ev.data);
    } catch {
      continue;
    }
    switch (data?.type) {
      case 'content_block_start':
        if (data.content_block?.type === 'tool_use') {
          blocks.set(data.index, { id: data.content_block.id, name: data.content_block.name, json: '' });
        }
        break;
      case 'content_block_delta':
        if (data.delta?.type === 'text_delta' && typeof data.delta.text === 'string') {
          text += data.delta.text;
          req.onText(data.delta.text);
        } else if (data.delta?.type === 'input_json_delta') {
          const block = blocks.get(data.index);
          if (block) block.json += data.delta.partial_json ?? '';
        }
        break;
      case 'message_delta':
        if (data.delta?.stop_reason) stop = data.delta.stop_reason;
        break;
      case 'error':
        throw new ProviderError(502, String(data.error?.message ?? 'erreur du fournisseur').slice(0, 500));
      default:
        // message_start, ping, content_block_stop, message_stop, types futurs : ignorés
        break;
    }
  }
  const toolCalls = [...blocks.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, b]) => ({ id: b.id, name: b.name, args: parseArgs(b.json) }));
  return { text, toolCalls, stop };
}

export function chat(req: ChatRequest): Promise<ChatResult> {
  return req.provider.type === 'anthropic' ? chatAnthropic(req) : chatOpenAi(req);
}

// Modèles proposés par le fournisseur (identifiants seulement, triés)
export async function listModels(p: ProviderConfig & { apiKey: string }): Promise<string[]> {
  const url = p.type === 'anthropic' ? `${p.baseUrl}/models?limit=1000` : `${p.baseUrl}/models`;
  const response = await fetch(url, { headers: headersFor(p), signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw await failure(response);
  const body: any = await response.json();
  const list: unknown[] = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
  const ids = list
    .map((m) => (typeof m === 'object' && m !== null ? (m as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === 'string');
  return [...new Set(ids)].sort();
}
