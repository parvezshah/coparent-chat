import { describe, expect, it } from 'vitest';
import hannahChart from '../data/charts/hannah.json';
import leoChart from '../data/charts/leo.json';
import miaChart from '../data/charts/mia.json';
import seed from '../data/people.seed.json';
import { ChartSchema } from '../lib/chart-provider';
import { buildSystemPrompt, type PromptInput, type PromptPerson } from '../lib/prompt';

const charts: Record<string, unknown> = { hannah: hannahChart, leo: leoChart, mia: miaChart };
const people: PromptPerson[] = seed.map(p => ({
  ...p,
  relationship: p.relationship as 'Parent' | 'Child',
  chart: ChartSchema.parse(charts[p.id]),
}));
const [hannah, leo, mia] = people;
const TODAY = '2026-10-27';

function input(focus: string[], today = TODAY): PromptInput {
  return { parent: hannah, children: [leo, mia], focus, today };
}
const block = (i: PromptInput, section: string) => buildSystemPrompt(i).blocks.find(b => b.section === section)!.text;
const all = (i: PromptInput) => buildSystemPrompt(i).blocks.map(b => b.text).join('\n\n');
const VARIANTS = [['leo'], ['mia'], ['leo', 'mia'], ['mia', 'leo']];
// The brief's lines section (source:117), written here so a drift in lib/prompt.ts reds case 5.
const LINES =
  "Never diagnose, label or predict a child. Don't give medical, developmental, mental-health or safety advice beyond encouraging the right professional and helping describe what's happening. When a question is about illness, injury, safety, or a serious change in behaviour, answer that part plainly and first, with no Human Design framing. Keep everything age-appropriate for the children named. Don't ask for or repeat a child's birth details.";

describe('buildSystemPrompt', () => {
  it('1. focus on Leo: Leo and his type in the family block, Mia and hers absent', () => {
    const family = block(input(['leo']), 'family');
    expect(family).toContain('Leo');
    expect(family).toContain('Manifesting Generator');
    expect(family).not.toContain('Mia');
    expect(family).not.toContain('Projector');
    expect(all(input(['leo']))).not.toContain('Mia');
  });

  it('2. focus on both: both appear, Leo before Mia, each under its own header line', () => {
    for (const focus of [['leo', 'mia'], ['mia', 'leo']]) {
      const family = block(input(focus), 'family');
      const leoAt = family.indexOf('\n\nLeo, child, age 7:\n');
      const miaAt = family.indexOf('\n\nMia, child, age 4:\n');
      expect(leoAt).toBeGreaterThan(-1);
      expect(miaAt).toBeGreaterThan(leoAt);
    }
  });

  it('3. the parent appears in every variant', () => {
    for (const focus of VARIANTS) expect(block(input(focus), 'family')).toContain('Hannah, parent, age 38:\nHannah is a Generator.');
  });

  it('4. ages are computed from today', () => {
    expect(block(input(['leo']), 'family')).toContain('Leo, child, age 7:');
    expect(block(input(['leo'], '2027-07-03'), 'family')).toContain('Leo, child, age 8:');
    expect(block(input(['leo'], '2027-07-02'), 'family')).toContain('Leo, child, age 7:');
    expect(block(input(['leo', 'mia']), 'today')).toBe('Today is 27 October 2026. Leo is 7, Mia is 4.');
  });

  it('5. the lines section is present verbatim in every variant', () => {
    for (const focus of VARIANTS) expect(block(input(focus), 'lines')).toBe(LINES);
  });

  it('6. under 6,000 characters with two children; only the family block carries the cache marker', () => {
    const { blocks } = buildSystemPrompt(input(['leo', 'mia']));
    expect(all(input(['leo', 'mia'])).length).toBeLessThan(6000);
    expect(blocks.filter(b => b.cache_control).map(b => b.section)).toEqual(['family']);
    expect(blocks.find(b => b.section === 'family')!.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('7. deterministic, and never mutates its inputs', () => {
    const frozen = structuredClone(input(['mia', 'leo']));
    const deepFreeze = (o: object) => {
      Object.values(o).forEach(v => v && typeof v === 'object' && deepFreeze(v));
      return Object.freeze(o);
    };
    const before = JSON.stringify(frozen);
    deepFreeze(frozen);
    expect(buildSystemPrompt(frozen)).toEqual(buildSystemPrompt(frozen));
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it("8. no person's date of birth, time of birth or birth place appears in any variant", () => {
    for (const focus of VARIANTS) {
      const text = all(input(focus));
      for (const p of people) {
        const [y, m, d] = p.birth.date.split('-');
        expect(text).not.toContain(p.birth.date);
        expect(text).not.toContain(`${Number(d)} ${['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(m)]} ${y}`);
        expect(text).not.toContain(p.birth.time);
        expect(text).not.toContain(p.birth.place);
      }
    }
  });
});
