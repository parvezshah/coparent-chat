// Charts come from a provider: the bundled sample set here, the Bodygraph Chart API in the real build.
// `Chart` is this app's own shape; a real provider maps the API's response to it.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const ChartSchema = z.object({
  _note: z.string().optional(),
  chartId: z.string(),
  type: z.string(),
  strategy: z.string(),
  authority: z.string(),
  profile: z.object({ lines: z.string(), keynotes: z.tuple([z.string(), z.string()]) }),
  definition: z.string(),
  centres: z.object({ defined: z.array(z.string()), undefined: z.array(z.string()) }),
  channels: z.array(z.object({ name: z.string(), gates: z.array(z.number()) })),
  incarnationCross: z.string(),
});
export type Chart = z.infer<typeof ChartSchema>;

export interface BirthData {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM, local to timeZone
  place: string;
  timeZone: string;
}

export interface ChartProvider {
  getChart(name: string, birth: BirthData): Promise<Chart>;
}

const CHARTS_DIR = path.join(process.cwd(), 'data', 'charts');
const SAMPLE_NAMES = ['hannah', 'leo', 'mia'];

// Returns the sample chart whose file matches the person's name, else the generic one.
export class FixtureChartProvider implements ChartProvider {
  async getChart(name: string): Promise<Chart> {
    const key = name.trim().toLowerCase();
    const file = SAMPLE_NAMES.includes(key) ? `${key}.json` : 'generic.json';
    const raw = await fs.readFile(path.join(CHARTS_DIR, file), 'utf8');
    return ChartSchema.parse(JSON.parse(raw));
  }
}

// Bodygraph Chart API base URL: to be confirmed from the client's docs.
export const BODYGRAPH_BASE_URL = '';

export class BodygraphChartProvider implements ChartProvider {
  async getChart(): Promise<Chart> {
    if (!process.env.BODYGRAPH_API_KEY) throw new Error('Bodygraph API not configured');
    throw new Error("Bodygraph API endpoint to be confirmed from the client's docs");
  }
}

export function getChartProvider(): ChartProvider {
  return process.env.CHART_PROVIDER === 'bodygraph' ? new BodygraphChartProvider() : new FixtureChartProvider();
}
