import { describe, expect, it } from 'vitest';
import leo from '../data/charts/leo.json';
import { ChartSchema } from '../lib/chart-provider';
import { chartSummary } from '../lib/chart-summary';

describe('chartSummary', () => {
  const summary = chartSummary(ChartSchema.parse(leo), { name: 'Leo' });

  it("names Leo's type, authority and profile", () => {
    expect(summary).toContain('Manifesting Generator');
    expect(summary).toContain('Sacral');
    expect(summary).toContain('6/2');
  });

  it('holds no JSON, lists or gates, and stays under 900 characters', () => {
    expect(summary).not.toContain('{');
    expect(summary).not.toContain('[');
    expect(summary.toLowerCase()).not.toContain('gate');
    expect(summary.length).toBeLessThan(900);
  });
});
