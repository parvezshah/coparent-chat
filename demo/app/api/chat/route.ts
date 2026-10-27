// Streaming chat. The browser sends who is selected, its date and the thread; the system prompt is built here
// from the stored charts by the same buildSystemPrompt the panel uses, so a prompt is never taken from the client.
// x-prompt-sha256 is the sha256 of that prompt's text, on every response.
import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { promptFor, promptText } from '../../../lib/prompt';
import { readPeople } from '../../../lib/store';

export const dynamic = 'force-dynamic';

const MODEL = 'claude-sonnet-5-5';
const NO_KEY = "The AI key isn't set on this machine. Everything else on this page works; the chat needs ANTHROPIC_API_KEY.";

const Body = z.object({
  ids: z.array(z.string()).max(2),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(200),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid request' }, { status: 400 });
  const { ids, today, messages } = parsed.data;

  const { blocks } = promptFor(await readPeople(), ids, today);
  const headers = {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-prompt-sha256': createHash('sha256').update(promptText(blocks)).digest('hex'),
  };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response(NO_KEY, { status: 503, headers });

  const client = new Anthropic({ apiKey });
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 600,
    // The lowest thinking setting on this model, so the 600 tokens go to the reply.
    thinking: { type: 'between_tools' },
    system: blocks.map(b => ({ type: 'text' as const, text: b.text, ...(b.cache_control ? { cache_control: b.cache_control } : {}) })),
    messages,
  });

  // Wait for the first event, so a refused key or a bad request comes back as an error, not an empty reply.
  const events = stream[Symbol.asyncIterator]();
  let first: IteratorResult<Anthropic.MessageStreamEvent>;
  try {
    first = await events.next();
  } catch (e) {
    const api = e instanceof Anthropic.APIError ? (e.error as { error?: { message?: string } } | undefined) : undefined;
    return new Response(api?.error?.message ?? 'The AI request failed.', { status: 502, headers });
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (let r = first; !r.done; r = await events.next()) {
          const ev = r.value;
          if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') controller.enqueue(encoder.encode(ev.delta.text));
        }
      } catch {
        // The reply ends where the stream broke.
      } finally {
        controller.close();
      }
    },
    cancel() {
      stream.abort();
    },
  });
  return new Response(body, { status: 200, headers });
}
