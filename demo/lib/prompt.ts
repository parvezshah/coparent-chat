// Pure: the system prompt, rebuilt from the family's charts for every message. The browser's panel and the
// chat route call the same function with the same inputs, so the panel shows exactly what the model gets.
import type { Chart } from './chart-provider';
import { chartSummary } from './chart-summary';

export interface PromptPerson {
  id: string;
  name: string;
  relationship: 'Parent' | 'Child';
  birth: { date: string; time?: string; place?: string; timeZone?: string };
  chart: Chart;
}

export type Section = 'role' | 'frame' | 'family' | 'lines' | 'style' | 'today';
export interface PromptBlock {
  section: Section;
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface PromptInput {
  parent: PromptPerson;
  coParents?: PromptPerson[]; // parents after the first: always in the family block
  children: PromptPerson[]; // every child, in family order
  focus: string[]; // the selected children's ids
  today: string; // YYYY-MM-DD
}

export const FRAME =
  "This family uses Human Design as a lens for understanding each other. Speak within that lens naturally and specifically, the way a thoughtful friend who knows the system would. Don't explain, defend or debate Human Design unless asked, and never present it as a prediction of what a child will do or become.";
export const LINES =
  "Never diagnose, label or predict a child. Don't give medical, developmental, mental-health or safety advice beyond encouraging the right professional and helping describe what's happening. When a question is about illness, injury, safety, or a serious change in behaviour, answer that part plainly and first, with no Human Design framing. Keep everything age-appropriate for the children named. Don't ask for or repeat a child's birth details.";
export const STYLE =
  'Be short and specific. One idea at a time. Offer one thing to try today. Ask at most one question back. Write in sentences, not lists, unless she asks for steps.';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y, m, d];
}

// Whole years from the birth date to today.
export function ageOn(birthDate: string, today: string): number {
  const [by, bm, bd] = parts(birthDate);
  const [ty, tm, td] = parts(today);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

export function longDate(today: string): string {
  const [y, m, d] = parts(today);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function selectedChildren(children: PromptPerson[], focus: string[]): PromptPerson[] {
  return children.filter(c => focus.includes(c.id));
}

export function buildSystemPrompt({ parent, coParents = [], children, focus, today }: PromptInput): { blocks: PromptBlock[] } {
  const chosen = selectedChildren(children, focus);
  const entry = (p: PromptPerson) =>
    `${p.name}, ${p.relationship.toLowerCase()}, age ${ageOn(p.birth.date, today)}:\n${chartSummary(p.chart, p)}`;
  const family = ['The family', ...[parent, ...coParents, ...chosen].map(entry)].join('\n\n');
  const ages = chosen.map(c => `${c.name} is ${ageOn(c.birth.date, today)}`).join(', ');
  return {
    blocks: [
      {
        section: 'role',
        text: `You are Co-Parent, a warm and practical companion for ${parent.name}, helping her understand and respond to her children day to day.`,
      },
      { section: 'frame', text: FRAME },
      { section: 'family', text: family, cache_control: { type: 'ephemeral' } },
      { section: 'lines', text: LINES },
      { section: 'style', text: STYLE },
      { section: 'today', text: `Today is ${longDate(today)}.${ages ? ` ${ages}.` : ''}` },
    ],
  };
}

// The prompt for a stored family and a selection: the first parent leads; children keep the family's order.
export function promptFor(people: PromptPerson[], focus: string[], today: string): { blocks: PromptBlock[] } {
  const parents = people.filter(p => p.relationship === 'Parent');
  return buildSystemPrompt({
    parent: parents[0],
    coParents: parents.slice(1),
    children: people.filter(p => p.relationship === 'Child'),
    focus,
    today,
  });
}

// The prompt as one text: what the panel's `Copy` copies and what the route's x-prompt-sha256 hashes.
export function promptText(blocks: PromptBlock[]): string {
  return blocks.map(b => b.text).join('\n\n');
}
