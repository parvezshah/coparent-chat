'use client';
// The screen: the family, the chat and `What the AI knows`. The panel is buildSystemPrompt's output for the current
// selection, recomputed on every render, so it changes the moment a child is tapped.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { chartLine, listOf } from '../../lib/chart-summary';
import { ageOn, promptFor, promptText, type PromptPerson } from '../../lib/prompt';
import s from './CoParent.module.css';

type Person = PromptPerson;
type Tab = 'family' | 'chat' | 'prompt';
interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  notice?: boolean; // the no-key message or an error: shown, never sent back to the model
}

const CHIPS = [
  "Leo won't start his homework and every nudge turns into a fight.",
  'Mia melts down at pickup, every single day.',
  'How do I handle a morning when both of them are off?',
  "Mia has had a fever for three days and she's very quiet.",
];
const TIME_ZONES = ['Pacific/Auckland', 'Australia/Sydney', 'Asia/Kolkata', 'Europe/London', 'America/New_York'];
const EMPTY_FORM = { name: '', relationship: 'Child', date: '', time: '', place: '', timeZone: 'Pacific/Auckland' };

function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// D10: paragraphs split at blank lines; runs of `- ` or `N. ` lines become a simple list; text nodes only.
function Reply({ text }: { text: string }) {
  const out: ReactNode[] = [];
  text.split(/\n\s*\n/).forEach((chunk, ci) => {
    let para: string[] = [];
    let list: { ordered: boolean; items: string[] } | null = null;
    const flush = (k: string) => {
      if (para.length) out.push(<p key={`p${k}`}>{para.join('\n')}</p>);
      if (list) {
        const items = list.items.map((t, i) => <li key={i}>{t}</li>);
        out.push(list.ordered ? <ol key={`l${k}`}>{items}</ol> : <ul key={`l${k}`}>{items}</ul>);
      }
      para = [];
      list = null;
    };
    chunk.split('\n').forEach((line, li) => {
      const bullet = /^\s*- (.*)$/.exec(line);
      const numbered = /^\s*\d+\. (.*)$/.exec(line);
      const item = bullet ?? numbered;
      if (item) {
        const ordered = !bullet;
        if (para.length || (list && list.ordered !== ordered)) flush(`${ci}-${li}`);
        if (!list) list = { ordered, items: [] };
        list.items.push(item[1]);
      } else if (line.trim()) {
        if (list) flush(`${ci}-${li}`);
        para.push(line);
      }
    });
    flush(`${ci}-end`);
  });
  return <>{out}</>;
}

export default function CoParent({ initialPeople, initialToday }: { initialPeople: Person[]; initialToday: string }) {
  const [people, setPeople] = useState(initialPeople);
  const [today, setToday] = useState(initialToday);
  const children = people.filter(p => p.relationship === 'Child');
  const parents = people.filter(p => p.relationship === 'Parent');
  const [selected, setSelected] = useState<string[]>(children.length ? [children[0].id] : []);
  const [compare, setCompare] = useState(false);
  const [tab, setTab] = useState<Tab>('family');
  const [drawer, setDrawer] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setToday(localDate(new Date())), []);
  // Keep the latest question at the top of the list, so a long reply's first paragraph stays in view as it grows.
  useEffect(() => {
    const el = listRef.current;
    const asked = el?.querySelectorAll('[data-role="user"]');
    const last = asked?.[asked.length - 1];
    if (el && last) el.scrollTop += last.getBoundingClientRect().top - el.getBoundingClientRect().top - 8;
  }, [messages]);

  const chosen = children.filter(c => selected.includes(c.id)); // family order, whatever the order of the taps
  const label = chosen.length ? listOf(chosen.map(c => c.name)) : (parents[0]?.name ?? '');
  const { blocks } = promptFor(people, selected, today);
  const text = promptText(blocks);

  // D7: one child at a time; with Compare, a tap toggles and a third replaces the one chosen earlier;
  // the last selected child stays selected.
  function tapChild(id: string) {
    if (!compare) return setSelected([id]);
    if (selected.includes(id)) return setSelected(selected.length > 1 ? selected.filter(x => x !== id) : selected);
    setSelected(selected.length < 2 ? [...selected, id] : [selected[1], id]);
  }

  function toggleCompare() {
    if (compare && chosen.length > 1) setSelected([chosen[0].id]);
    setCompare(!compare);
  }

  async function remove(id: string) {
    const res = await fetch(`/api/people?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) return;
    const rest = people.filter(p => p.id !== id);
    setPeople(rest);
    const kept = selected.filter(x => x !== id);
    const firstChild = rest.find(p => p.relationship === 'Child');
    setSelected(kept.length ? kept : firstChild ? [firstChild.id] : []);
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    const res = await fetch('/api/people', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        relationship: form.relationship,
        birth: { date: form.date, time: form.time, place: form.place, timeZone: form.timeZone },
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setFormError(body.error ?? String(res.status));
    const person: Person = body.person;
    setPeople([...people, person]);
    if (person.relationship === 'Child' && !children.length) setSelected([person.id]);
    setFresh(person.id);
    setTimeout(() => setFresh(null), 1000);
    setForm(EMPTY_FORM);
    setFormOpen(false);
  }

  async function send(content: string) {
    const question = content.trim();
    if (!question || streaming) return;
    const history = messages.filter(m => !m.notice && m.content).map(({ role, content }) => ({ role, content }));
    const user: Message = { id: nextId.current++, role: 'user', content: question };
    const reply: Message = { id: nextId.current++, role: 'assistant', content: '' };
    setMessages(m => [...m, user, reply]);
    setDraft('');
    setStreaming(true);
    const update = (patch: Partial<Message>) => setMessages(m => m.map(x => (x.id === reply.id ? { ...x, ...patch } : x)));
    const controller = new AbortController();
    abort.current = controller;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: chosen.map(c => c.id), today, messages: [...history, { role: 'user', content: question }] }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.text();
        let shown = body;
        try {
          shown = JSON.parse(body).error ?? body;
        } catch {
          // plain text: the no-key message or the API's own error
        }
        update({ content: shown, notice: true });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        update({ content: acc });
      }
    } catch {
      // `New chat` aborted the stream, or the network dropped: the reply keeps what arrived.
    } finally {
      setMessages(m => m.filter(x => x.id !== reply.id || x.content));
      if (abort.current === controller) {
        abort.current = null;
        setStreaming(false);
      }
    }
  }

  function newChat() {
    abort.current?.abort();
    abort.current = null;
    setStreaming(false);
    setMessages([]);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard refused: nothing to show.
    }
  }

  const card = (p: Person) => {
    const relation = p.relationship === 'Parent' ? 'Parent' : `Child · age ${ageOn(p.birth.date, today)}`;
    const body = (
      <>
        <span className={s.name}>{p.name}</span>
        <span className={s.relation}>{relation}</span>
        <span className={s.chartLine}>{chartLine(p.chart)}</span>
      </>
    );
    const cls = `${s.card} ${fresh === p.id ? s.fresh : ''}`;
    if (p.relationship === 'Parent')
      return (
        <li key={p.id} className={cls} data-person={p.name}>
          <div className={s.cardMain}>{body}</div>
        </li>
      );
    const on = selected.includes(p.id);
    return (
      <li key={p.id} className={`${cls} ${on ? s.selected : ''}`} data-person={p.name}>
        <button type="button" className={s.cardMain} aria-pressed={on} onClick={() => tapChild(p.id)}>
          {body}
        </button>
        <button type="button" className={s.link} aria-label={`Remove ${p.name}`} onClick={() => remove(p.id)}>
          Remove
        </button>
      </li>
    );
  };

  return (
    <div className={s.shell} data-tab={tab} data-drawer={drawer ? 'open' : 'closed'}>
      <header className={s.header}>
        <span className={s.wordmark}>Co-Parent</span>
        <span className={s.byline}>demo · Taraveen</span>
      </header>

      <nav className={s.tabs} role="tablist" aria-label="Panes">
        {(['family', 'chat', 'prompt'] as Tab[]).map(t => (
          <button key={t} type="button" role="tab" id={`tab-${t}`} aria-selected={tab === t} className={s.tab} onClick={() => setTab(t)}>
            {t === 'family' ? 'Family' : t === 'chat' ? 'Chat' : 'Prompt'}
          </button>
        ))}
      </nav>

      <main className={s.main}>
        <section className={`${s.pane} ${s.family}`} aria-labelledby="family-title">
          <div className={s.familyHead}>
            <h2 id="family-title">Your family</h2>
            <button type="button" className={s.toggle} aria-pressed={compare} onClick={toggleCompare}>
              Compare
            </button>
          </div>
          <ul className={s.cards}>{people.map(card)}</ul>
          <button type="button" className={s.link} aria-expanded={formOpen} aria-controls="add-form" onClick={() => setFormOpen(!formOpen)}>
            Add a person
          </button>
          {formOpen && (
            <form id="add-form" className={s.form} onSubmit={add}>
              <div className={s.field}>
                <label htmlFor="f-name">Name</label>
                <input id="f-name" required maxLength={40} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className={s.field}>
                <label htmlFor="f-relationship">Relationship</label>
                <select id="f-relationship" value={form.relationship} onChange={e => setForm({ ...form, relationship: e.target.value })}>
                  <option value="Parent">Parent</option>
                  <option value="Child">Child</option>
                </select>
              </div>
              <div className={s.field}>
                <label htmlFor="f-date">Date of birth</label>
                <input id="f-date" type="date" required value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
              </div>
              <div className={s.field}>
                <label htmlFor="f-time">Time of birth</label>
                <input id="f-time" type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} />
              </div>
              <div className={s.field}>
                <label htmlFor="f-place">Birth place</label>
                <input id="f-place" maxLength={80} value={form.place} onChange={e => setForm({ ...form, place: e.target.value })} />
              </div>
              <div className={s.field}>
                <label htmlFor="f-zone">Time zone</label>
                <select id="f-zone" value={form.timeZone} onChange={e => setForm({ ...form, timeZone: e.target.value })}>
                  {TIME_ZONES.map(z => (
                    <option key={z}>{z}</option>
                  ))}
                </select>
              </div>
              <button type="submit" className={s.primary}>
                Add
              </button>
              {formError && <p role="alert">{formError}</p>}
              <p className={s.helper}>The chart is calculated from the birth moment. In this demo, charts come from a sample set.</p>
            </form>
          )}
        </section>

        <section className={`${s.pane} ${s.chat}`} aria-label="Chat" data-streaming={streaming}>
          <div className={s.chatHead}>
            <button type="button" className={s.drawerButton} aria-expanded={drawer} aria-controls="prompt-pane" onClick={() => setDrawer(!drawer)}>
              What the AI knows
            </button>
            <span className={s.chip} data-testid="talking-about">
              Talking about: {label}
            </span>
            <button type="button" className={s.link} onClick={newChat}>
              New chat
            </button>
          </div>
          <div className={s.messages} ref={listRef} aria-busy={streaming} tabIndex={0} aria-label="Messages">
            {messages.map(m => (
              <div key={m.id} className={`${s.message} ${m.role === 'user' ? s.parent : s.ai}`} data-role={m.role} data-text={m.role === 'assistant' ? m.content : undefined}>
                {m.role === 'assistant' && !m.content ? (
                  <span className={s.dot} aria-label="Typing" />
                ) : m.role === 'assistant' && !m.notice ? (
                  <Reply text={m.content} />
                ) : (
                  <p>{m.content}</p>
                )}
              </div>
            ))}
          </div>
          <div className={s.suggestions}>
            {CHIPS.map(c => (
              <button key={c} type="button" className={s.suggestion} disabled={streaming} onClick={() => send(c)}>
                {c}
              </button>
            ))}
          </div>
          <form
            className={s.composer}
            onSubmit={e => {
              e.preventDefault();
              send(draft);
            }}
          >
            <input aria-label="Message" maxLength={4000} placeholder={`Ask about ${label}…`} value={draft} onChange={e => setDraft(e.target.value)} />
            <button type="submit" className={s.primary} disabled={streaming || !draft.trim()}>
              Send
            </button>
          </form>
        </section>

        <section id="prompt-pane" className={`${s.pane} ${s.panel}`} aria-labelledby="panel-title">
          <h2 id="panel-title">What the AI knows</h2>
          <p className={s.helper}>This is the exact system prompt sent with your next message. It changes with who you select.</p>
          <div className={s.prompt} data-testid="prompt">
            {blocks.map(b => (
              <pre key={b.section} data-section={b.section}>
                {b.text}
              </pre>
            ))}
          </div>
          <div className={s.panelFoot}>
            <span>{Math.round(text.length / 4)} tokens, approx.</span>
            <button type="button" className={s.link} onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </section>
      </main>

      <footer className={s.footer}>
        <span>Built by Parvez Shah · Taraveen</span>
        <span>Demo only. Sample charts; invented family.</span>
      </footer>
    </div>
  );
}
