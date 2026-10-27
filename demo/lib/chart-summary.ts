// Pure: a chart becomes a short prose summary for the system prompt. Only the fields below are read;
// no gate lists, no planetary tables, no JSON.
import type { Chart } from './chart-provider';

export function listOf(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function chartSummary(chart: Chart, person: { name: string }): string {
  const [first, second] = chart.profile.keynotes;
  const channels = chart.channels.slice(0, 4).map(c => c.name);
  return [
    `${person.name} is a ${chart.type}. Strategy: ${chart.strategy}. Authority: ${chart.authority}.`,
    `Profile ${chart.profile.lines}, the ${first} and ${second} lines.`,
    `${chart.definition} definition: ${listOf(chart.centres.defined)} defined; ${listOf(chart.centres.undefined)} open.`,
    channels.length ? `Channels: ${listOf(channels)}.` : 'No channels defined.',
    `Incarnation cross: ${chart.incarnationCross}.`,
  ].join(' ');
}

// The card's line: `Manifesting Generator · Sacral · 6/2`.
export function chartLine(chart: Chart): string {
  return [chart.type, chart.authority.split(' (')[0], chart.profile.lines].join(' · ');
}
