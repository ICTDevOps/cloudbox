// Panneau Assistant d'un workspace (Dockview) : conversation avec le modèle choisi, outils de lecture
// (contexte réel, terminaux, fichiers) exécutés par cloudbox-api, commandes proposées sur des cartes.
// Une commande n'est tapée et lancée (Entrée) dans un terminal qu'après un clic sur « Exécuter » ;
// en PRD, une case de confirmation en plus. Le contexte réel est affiché sur la carte, en rouge s'il
// ne correspond pas au tenant ou à l'abonnement déclaré du workspace.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  api, type AssistantConfig, type AssistantEvent, type AssistantState, type CloudContext, type Conversation, type Proposal,
  type Workspace, type WorkspaceSettings,
} from './api';
import { CopyButton } from './connections';
import { useCloudContext } from './context';
import type { DockHandle } from './dock';
import { t, useLang } from './i18n';
import { openSettings } from './prefs';

// --- Configuration (partagée par les panneaux et la barre d'outils) ---

let config: AssistantConfig | null = null;
const configListeners = new Set<() => void>();

export const assistantConfigStore = {
  get: () => config,
  async reload(): Promise<void> {
    try {
      config = await api.assistantConfig();
    } catch {
      config = null;
    }
    configListeners.forEach((l) => l());
  },
  set(next: AssistantConfig): void {
    config = next;
    configListeners.forEach((l) => l());
  },
};

export function useAssistantConfig(): AssistantConfig | null {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const l = () => setVersion((v) => v + 1);
    configListeners.add(l);
    if (!config) assistantConfigStore.reload();
    return () => void configListeners.delete(l);
  }, []);
  return config;
}

// --- Markdown minimal, rendu en éléments Preact (jamais de HTML brut : CSP stricte, contenu non fiable) ---

function inline(text: string): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    out.push(token.startsWith('`') ? <code>{token.slice(1, -1)}</code> : <strong>{token.slice(2, -2)}</strong>);
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function CodeBlock({ code, onInsert }: { code: string; onInsert: ((cmd: string) => void) | null }) {
  const singleLine = !code.includes('\n') && code.length <= 2000;
  return (
    <div class="md-code">
      <pre><code>{code}</code></pre>
      <div class="md-code-actions">
        <CopyButton text={code} />
        {singleLine && onInsert && (
          <button type="button" class="copy insert" onClick={() => onInsert(code)}>▶ {t().assistant.insert}</button>
        )}
      </div>
    </div>
  );
}

function Markdown({ text, onInsert }: { text: string; onInsert: ((cmd: string) => void) | null }) {
  const blocks: ComponentChildren[] = [];
  const parts = text.split(/^```[^\n]*\n?/m);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      blocks.push(<CodeBlock key={`c${i}`} code={part.replace(/\n$/, '')} onInsert={onInsert} />);
      return;
    }
    const paragraphs = part.split(/\n{2,}/);
    paragraphs.forEach((para, j) => {
      const lines = para.split('\n').filter((l) => l.trim() !== '');
      if (!lines.length) return;
      const key = `p${i}-${j}`;
      if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
        const ordered = /^\s*\d+\./.test(lines[0]);
        const items = lines.map((l, k) => <li key={k}>{inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>);
        blocks.push(ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
      } else if (/^#{1,4}\s/.test(lines[0]) && lines.length === 1) {
        blocks.push(<p key={key} class="md-heading">{inline(lines[0].replace(/^#+\s*/, ''))}</p>);
      } else {
        blocks.push(<p key={key}>{lines.flatMap((l, k) => (k ? [<br key={k} />, ...inline(l)] : inline(l)))}</p>);
      }
    });
  });
  return <div class="md">{blocks}</div>;
}

// --- Carte d'une commande proposée ---

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Verbes qui modifient ou suppriment (az, kubectl, helm, tofu/terraform, cmdlets PowerShell)
const DESTRUCTIVE_RE =
  /(\b(Remove|Clear|Set|New|Update|Disable|Enable|Stop|Restart|Revoke|Reset|Grant|Add|Move|Rename|Uninstall|Invoke)-[A-Za-z]|\b(delete|remove|destroy|purge|apply|create|update|set|scale|drain|cordon|replace|patch|deallocate|stop|restart|uninstall|upgrade|rollback|import|assign|move|rm|kill)\b)/i;

function contextWarnings(ctx: CloudContext | null, s: WorkspaceSettings): string[] {
  const m = t().assistant;
  const az = ctx?.azureCli;
  if (!az) return [];
  const out: string[] = [];
  if (s.tenant && GUID_RE.test(s.tenant) && s.tenant.toLowerCase() !== az.tenantId.toLowerCase()) out.push(m.mismatchTenant);
  if (s.subscription && s.subscription.toLowerCase() !== az.subscriptionId.toLowerCase()) out.push(m.mismatchSubscription);
  return out;
}

function ProposalCard({ p, result, ws, dock, busy, onApprove, onReject }: {
  p: Proposal;
  result: string | null;
  ws: Workspace;
  dock: DockHandle | null;
  busy: boolean;
  onApprove: (p: Proposal, command: string, session: string, confirmPrd: boolean) => void;
  onReject: (p: Proposal) => void;
}) {
  const m = t().assistant;
  const [command, setCommand] = useState(p.command);
  const [confirmPrd, setConfirmPrd] = useState(false);
  const ctxState = useCloudContext();
  const ctx = ctxState && ctxState !== 'error' ? ctxState : null;
  const pending = p.status === 'pending';
  const target = dock?.terminalFor(p.shell) ?? null;
  const warnings = contextWarnings(ctx, ws.settings ?? {});
  const prd = ws.env === 'prd';
  const destructive = DESTRUCTIVE_RE.test(pending ? command : p.executed ?? p.command);
  const shellLabel = p.shell === 'pwsh' ? 'PowerShell' : 'Bash';
  const canRun = pending && !busy && Boolean(target) && command.trim() !== '' && !command.includes('\n') && (!prd || confirmPrd);

  return (
    <div class={`proposal status-${p.status}${prd ? ' prd' : ''}${warnings.length ? ' mismatch' : ''}`}>
      <div class="proposal-head">
        <span class="proposal-title">{m.proposal}</span>
        <span class="conn-shell">{p.shell === 'pwsh' ? 'PS' : 'sh'}</span>
        <span class={`proposal-status ${p.status}`}>{m.status[p.status]}</span>
      </div>
      {p.reason && <p class="proposal-reason">{p.reason}</p>}
      {pending ? (
        <textarea class="proposal-cmd" rows={Math.min(6, Math.max(1, Math.ceil(command.length / 60)))} spellcheck={false}
          value={command} onInput={(e) => setCommand(e.currentTarget.value.replace(/\n/g, ' '))} aria-label={m.proposal} />
      ) : (
        <code class="proposal-cmd done">{p.executed ?? p.command}</code>
      )}
      {!pending && p.executed && p.executed !== p.command && <p class="field-help">{m.editedFrom(p.command)}</p>}
      {destructive && <p class="proposal-warn">⚠ {m.destructive}</p>}
      {pending && (
        <>
          <div class="proposal-context">
            <span class="muted">{m.contextNow} :</span>{' '}
            {ctx?.azureCli
              ? <span class={warnings.length ? 'error' : ''}>az · {ctx.azureCli.subscription} <span class="muted">({ctx.azureCli.tenantId})</span></span>
              : <span class="muted">{m.notSignedIn}</span>}
            {ctx?.kubernetes && <span> · ⎈ {ctx.kubernetes.context}</span>}
          </div>
          {warnings.map((w) => <p key={w} class="proposal-warn strong">⚠ {w}</p>)}
          {prd && (
            <div class="proposal-prd">
              <strong>{m.prdBanner}</strong>
              <label><input type="checkbox" checked={confirmPrd} onChange={(e) => setConfirmPrd(e.currentTarget.checked)} /> {m.prdConfirm}</label>
            </div>
          )}
          <p class="field-help">{m.editHint}</p>
          <div class="proposal-actions">
            <button type="button" class={`button ${prd ? 'danger' : 'primary'}`} disabled={!canRun}
              title={target ? '' : m.needTerminal(shellLabel)}
              onClick={() => target && onApprove(p, command.trim(), target.session, confirmPrd)}>
              ▶ {target ? m.runIn(target.title) : m.needTerminal(shellLabel)}
            </button>
            <button type="button" class="button ghost" disabled={busy} onClick={() => onReject(p)}>{m.reject}</button>
          </div>
        </>
      )}
      {!pending && p.session && <p class="field-help">{m.inSession(p.session)}{p.note ? ` — ${p.note}` : ''}</p>}
      {result && p.status === 'approved' && (
        <details class="tool-result" open>
          <summary>{m.toolOutput}</summary>
          <pre>{result}</pre>
        </details>
      )}
    </div>
  );
}

// --- Panneau ---

export function AssistantPanel({ ws, getDock }: { ws: Workspace; getDock: () => DockHandle | null }) {
  useLang(); // monté hors de l'arbre principal : suit lui-même la langue
  const m = t().assistant;
  const cfg = useAssistantConfig();
  const [state, setState] = useState<AssistantState | null>(null);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [input, setInput] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<{ text: string; status: string } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memory, setMemory] = useState('');
  const [, setTick] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const liveRef = useRef({ text: '', status: '' });
  const dock = getDock();

  // Le dock change (terminal actif, panneaux ouverts) : cible des commandes mise à jour
  useEffect(() => {
    const d = getDock();
    if (!d) {
      const timer = window.setTimeout(() => setTick((x) => x + 1), 200);
      return () => window.clearTimeout(timer);
    }
    return d.onChange(() => setTick((x) => x + 1));
  }, [dock]);

  const loadState = async () => {
    try {
      const s = await api.assistantState(ws.id);
      setState(s);
      return s;
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  };

  const openConversation = async (id: string) => {
    try {
      const c = await api.getConversation(ws.id, id);
      setConv(c);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    if (!cfg?.enabled) return;
    loadState().then((s) => {
      if (s?.conversations[0]) openConversation(s.conversations[0].id);
    });
  }, [cfg?.enabled, ws.id]);

  // Fournisseur et modèle : ceux de la conversation, sinon ceux du workspace, sinon ceux par défaut
  useEffect(() => {
    const def = ws.assistant ?? state?.default ?? cfg?.default ?? null;
    setProvider(conv?.provider ?? def?.provider ?? cfg?.providers.find((p) => p.configured)?.id ?? '');
    setModel(conv?.model ?? def?.model ?? '');
  }, [conv?.id, state, cfg, ws.assistant?.provider, ws.assistant?.model]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conv, live]);

  if (!cfg) return <div class="assistant"><p class="muted assistant-empty">{t().common.loading}</p></div>;
  if (!cfg.allowed) return <div class="assistant"><p class="muted assistant-empty">{m.forbidden}</p></div>;
  const goSettings = <button type="button" class="button small" onClick={() => openSettings('ai')}>{m.openSettings}</button>;
  if (!cfg.enabled) return <div class="assistant"><p class="muted assistant-empty">{m.disabled} {goSettings}</p></div>;
  const configured = cfg.providers.filter((p) => p.configured);
  if (!configured.length) return <div class="assistant"><p class="muted assistant-empty">{m.noProvider} {goSettings}</p></div>;

  const onEvent = (e: AssistantEvent) => {
    const l = liveRef.current;
    switch (e.event) {
      case 'text':
        l.text += e.data.text;
        l.status = '';
        break;
      case 'tool':
        l.status = e.data.state === 'start' ? (m.tools[e.data.name] ?? e.data.name) + '…' : m.thinking;
        break;
      case 'executed':
        l.status = m.thinking;
        if (conv) openConversation(conv.id);
        break;
      case 'error':
        setError(e.data.message);
        break;
      case 'done':
        if (e.data.reason === 'aborted') setNotice(m.aborted);
        else if (e.data.reason === 'max_rounds') setNotice(m.maxRounds);
        break;
      default:
        break;
    }
    setLive({ ...l });
  };

  // Déroulé d'un échange (message, validation, refus) : flux SSE, puis conversation relue
  const exchange = async (convId: string, start: (signal: AbortSignal) => Promise<void>, status: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    liveRef.current = { text: '', status };
    setLive({ ...liveRef.current });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await start(controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) setError((err as Error).message);
    } finally {
      abortRef.current = null;
      await openConversation(convId);
      setLive(null);
      setBusy(false);
      loadState();
    }
  };

  const activeSession = () => getDock()?.terminalFor('any')?.session;

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    let current = conv;
    if (!current) {
      try {
        current = await api.newConversation(ws.id);
      } catch (err) {
        setError((err as Error).message);
        return;
      }
    }
    // Affichage immédiat du message
    setConv({ ...current, messages: [...current.messages, { role: 'user', text }] });
    setInput('');
    const id = current.id;
    await exchange(id, (signal) =>
      api.sendMessage(ws.id, id, { text, provider, model, activeSession: activeSession() }, onEvent, signal), m.thinking);
  };

  const approve = (p: Proposal, command: string, session: string, confirmPrd: boolean) => {
    if (!conv) return;
    const id = conv.id;
    exchange(id, (signal) => api.approveProposal(ws.id, id, p.id, { session, command, confirmPrd }, onEvent, signal), m.running);
  };

  const reject = (p: Proposal) => {
    if (!conv) return;
    const reason = window.prompt(m.rejectReason, '');
    if (reason === null) return;
    const id = conv.id;
    exchange(id, (signal) => api.rejectProposal(ws.id, id, p.id, { reason, activeSession: activeSession() }, onEvent, signal), m.thinking);
  };

  const stop = () => {
    api.stopAssistant(ws.id).catch(() => undefined);
    abortRef.current?.abort();
  };

  const insert = async (cmd: string) => {
    const target = getDock()?.terminalFor('any');
    if (!target) {
      setError(m.noTerminal);
      return;
    }
    try {
      await api.sendInput(ws.id, target.session, cmd);
      setNotice(t().conn.inserted(target.title));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const loadModels = async () => {
    if (!provider) return;
    try {
      const list = await api.assistantModels(provider);
      setModels({ ...models, [provider]: list });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const toggleMemory = async () => {
    if (memoryOpen) {
      setMemoryOpen(false);
      return;
    }
    try {
      setMemory(await api.assistantMemory(ws.id));
      setMemoryOpen(true);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const saveMemory = async () => {
    try {
      await api.saveAssistantMemory(ws.id, memory);
      setMemoryOpen(false);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const removeConversation = async () => {
    if (!conv || !window.confirm(m.confirmDelete(conv.title || m.untitled))) return;
    try {
      await api.deleteConversation(ws.id, conv.id);
      setConv(null);
      loadState();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Résultats des outils, par appel
  const results = new Map<string, string>();
  for (const msg of conv?.messages ?? []) if (msg.role === 'tool') results.set(msg.callId, msg.content);
  const proposals = new Map((conv?.proposals ?? []).map((p) => [p.callId, p]));
  const listId = `models-${ws.id}`;
  const terminal = dock?.terminalFor('any') ?? null;

  return (
    <div class="assistant">
      <div class="assistant-bar">
        <select aria-label={m.conversations} value={conv?.id ?? ''} disabled={busy}
          onChange={(e) => (e.currentTarget.value ? openConversation(e.currentTarget.value) : setConv(null))}>
          <option value="">{m.newConversation}</option>
          {state?.conversations.map((c) => (
            <option key={c.id} value={c.id}>{c.title || m.untitled}{c.pending ? ' ●' : ''}</option>
          ))}
        </select>
        <button type="button" class="button ghost small" disabled={busy || !conv} onClick={() => setConv(null)} title={m.newConversation}>+</button>
        <button type="button" class="button ghost small" disabled={busy || !conv} onClick={removeConversation} title={m.deleteConversation}
          aria-label={m.deleteConversation}>🗑</button>
        <button type="button" class={`button ghost small${memoryOpen ? ' primary' : ''}`} onClick={toggleMemory} title={m.memoryTitle}>{m.memory}</button>
      </div>
      <div class="assistant-bar">
        <select aria-label={m.provider} value={provider} disabled={busy} onChange={(e) => setProvider(e.currentTarget.value)}>
          {configured.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <input class="assistant-model" list={listId} value={model} placeholder={m.modelPlaceholder} aria-label={m.model}
          spellcheck={false} disabled={busy} onInput={(e) => setModel(e.currentTarget.value.trim())} onFocus={() => !models[provider] && loadModels()} />
        <datalist id={listId}>{(models[provider] ?? []).map((id) => <option key={id} value={id} />)}</datalist>
      </div>
      {memoryOpen && (
        <div class="assistant-memory">
          <p class="field-help">{m.memoryHelp}</p>
          <textarea rows={6} value={memory} onInput={(e) => setMemory(e.currentTarget.value)} spellcheck={false} />
          <div class="proposal-actions">
            <button type="button" class="button primary small" onClick={saveMemory}>{t().common.save}</button>
            <button type="button" class="button ghost small" onClick={() => setMemoryOpen(false)}>{t().common.cancel}</button>
          </div>
        </div>
      )}
      <div class="assistant-list" ref={listRef} aria-live="polite">
        {!conv?.messages.length && !live && (
          <div class="assistant-empty muted">
            <p>{m.empty}</p>
            {state && <p class="field-help">{m.agentsHint(state.agentsFile)}</p>}
          </div>
        )}
        {conv?.messages.map((msg, i) => {
          if (msg.role === 'user') return <div key={i} class="msg user">{msg.text}</div>;
          if (msg.role === 'tool') return null;
          return (
            <div key={i} class="msg assistant-msg">
              {msg.text && <Markdown text={msg.text} onInsert={terminal ? insert : null} />}
              {msg.toolCalls?.map((call) => {
                const p = call.name === 'run_command' ? proposals.get(call.id) : undefined;
                if (p) {
                  return <ProposalCard key={call.id} p={p} result={results.get(call.id) ?? null} ws={ws} dock={dock}
                    busy={busy} onApprove={approve} onReject={reject} />;
                }
                return (
                  <details key={call.id} class="tool-line">
                    <summary>{m.tools[call.name] ?? call.name}
                      {typeof call.args.path === 'string' && <code> {call.args.path}</code>}
                      {typeof call.args.session === 'string' && <code> {call.args.session}</code>}
                    </summary>
                    <pre>{results.get(call.id) ?? ''}</pre>
                  </details>
                );
              })}
            </div>
          );
        })}
        {live && (
          <div class="msg assistant-msg live">
            {live.text && <Markdown text={live.text} onInsert={null} />}
            {live.status && <p class="muted assistant-status">{live.status}</p>}
          </div>
        )}
      </div>
      {error && <p class="error assistant-error" role="alert">{error}</p>}
      {notice && <p class="muted assistant-notice" role="status">{notice}</p>}
      <form class="assistant-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea rows={3} value={input} placeholder={m.placeholder} aria-label={m.placeholder}
          onInput={(e) => setInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
              e.preventDefault();
              send();
            }
          }} />
        {busy
          ? <button type="button" class="button" onClick={stop}>{m.stop}</button>
          : <button type="submit" class="button primary" disabled={!input.trim() || !provider || !model}>{m.send}</button>}
      </form>
      <p class="field-help assistant-foot">{m.redaction}</p>
    </div>
  );
}
