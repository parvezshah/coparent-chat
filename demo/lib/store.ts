// The family, kept in data/people.json on this machine. Read from disk on every request; when the file is
// absent it is written from data/people.seed.json, each seed person's chart fetched through the provider.
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ChartSchema, getChartProvider } from './chart-provider';
import type { PromptPerson } from './prompt';

export type Person = PromptPerson;

const DATA = path.join(process.cwd(), 'data');
const FILE = path.join(DATA, 'people.json');
const SEED = path.join(DATA, 'people.seed.json');

const BirthSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^(\d{2}:\d{2})?$/),
  place: z.string().max(80),
  timeZone: z.string().min(1).max(64),
});
export const NewPersonSchema = z.object({
  name: z.string().trim().min(1).max(40),
  relationship: z.enum(['Parent', 'Child']),
  birth: BirthSchema,
});
const PersonSchema = NewPersonSchema.extend({ id: z.string(), chart: ChartSchema });
const SeedSchema = z.array(NewPersonSchema.extend({ id: z.string() }));

async function write(people: Person[]): Promise<void> {
  await fs.writeFile(FILE, JSON.stringify(people, null, 2) + '\n');
}

export async function readPeople(): Promise<Person[]> {
  try {
    return z.array(PersonSchema).parse(JSON.parse(await fs.readFile(FILE, 'utf8')));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const provider = getChartProvider();
  const seed = SeedSchema.parse(JSON.parse(await fs.readFile(SEED, 'utf8')));
  const people: Person[] = [];
  for (const p of seed) people.push({ ...p, chart: await provider.getChart(p.name, p.birth) });
  await write(people);
  return people;
}

export async function addPerson(input: z.infer<typeof NewPersonSchema>): Promise<Person> {
  const people = await readPeople();
  const chart = await getChartProvider().getChart(input.name, input.birth);
  const person: Person = { ...input, id: `${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomUUID().slice(0, 6)}`, chart };
  await write([...people, person]);
  return person;
}

// Children only: a parent card has no `Remove`.
export async function removePerson(id: string): Promise<boolean> {
  const people = await readPeople();
  const kept = people.filter(p => !(p.id === id && p.relationship === 'Child'));
  if (kept.length === people.length) return false;
  await write(kept);
  return true;
}
