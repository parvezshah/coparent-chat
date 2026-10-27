// List, add and remove people in the JSON file store. Adding fetches the chart through the provider.
import { NewPersonSchema, addPerson, readPeople, removePerson } from '../../../lib/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ people: await readPeople() });
}

export async function POST(request: Request) {
  const parsed = NewPersonSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid person' }, { status: 400 });
  try {
    return Response.json({ person: await addPerson(parsed.data) }, { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get('id') ?? '';
  return (await removePerson(id)) ? new Response(null, { status: 204 }) : Response.json({ error: 'not found' }, { status: 404 });
}
