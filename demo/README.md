# Co-Parent — chart-grounded chat demo

I built this as a runnable local slice of Co-Parent: one screen, one chat route, one small JSON store. A parent and
two children with birth data, each with a Human Design chart, and a chat with Claude about the child you choose.
Everything personal in it is invented.

## What this proves

1. **The dynamic system prompt is real and visible.** Pick Leo and the panel `What the AI knows` shows his type,
   authority and profile in the prompt; pick Mia and it changes, pick both with `Compare` and both are there. The
   chart is never pasted as JSON: `lib/chart-summary.ts` writes a compact summary per person, and
   `lib/prompt.ts` builds the prompt as a pure, tested function that the panel and the server both call.
2. **The AI stays inside the frame and inside the lines.** The prompt has it speak within Human Design as the lens
   the family has chosen, warmly and without debating it. It never diagnoses or labels a child, and a question
   about health, safety or development is answered plainly and first, pointing to the right professional, with
   no chart talk on that part.
3. **The Bodygraph API is a swap, not a rewrite.** Charts come through a `ChartProvider` interface; the demo uses a
   bundled sample set, and `BodygraphChartProvider` is the stub that reads the key from the environment. The
   section below says exactly where the client's API plugs in.

There is no login in the demo; the full build uses hosted auth with row-level security.

## Run it

```
cp .env.example .env      # then put the Anthropic key after ANTHROPIC_API_KEY=
npm i
npm run dev               # http://localhost:3000
npm test                  # the prompt and summary tests (vitest)
```

Without a key the chat says so and everything else works. A key already exported in the shell wins over `.env`
(Next.js does not overwrite a variable that is already set). The npm scripts set `NEXT_TELEMETRY_DISABLED=1`
inline, which needs a POSIX shell: on Windows, set `NEXT_TELEMETRY_DISABLED=1` in the environment and run
`npx next dev` (or `npx next build`, `npx next start`) in place of the npm scripts.

The browser checks: `npx playwright install chromium`, `npm run build`, then `node scripts/check.mjs`, which starts
its own servers on 127.0.0.1, ports 3000 and 3001, and writes the screenshots and the video into `screenshots/`. It
deletes `data/people.json` before each scenario, so each starts from the seed family: anyone added is gone.

## Where the real APIs plug in

- **Bodygraph Chart API**: `lib/chart-provider.ts`, class `BodygraphChartProvider`. Fill the one constant,
  `BODYGRAPH_BASE_URL`, from the client's docs, map the API's response onto the app's `Chart` type (the fields
  the summary reads), and set `CHART_PROVIDER=bodygraph` and `BODYGRAPH_API_KEY` in `.env`. Until then it throws
  `Bodygraph API not configured`, or with a key `Bodygraph API endpoint to be confirmed from the client's docs`.
- **Claude**: `app/api/chat/route.ts`, streaming, model `claude-sonnet-5-5`, at most 600 output tokens per reply.
  The key is read only on the server. The family block carries the prompt-caching marker. A prompt is cached only
  from the model's minimum length (512 tokens for this model in Anthropic's caching docs); in this demo the prompt
  up to the family block is about 370 tokens with both children, so it is not cached until the family block grows.

## What the full build adds

Hosted auth with per-user data isolation (row-level security), Postgres, the real chart provider with each
person's chart cached, chat history per person, a public URL, and a privacy page.

## Privacy

The build keeps children's birth data to the minimum the chart needs, and never sends it to the model: only the
chart summary goes into the prompt (a test checks that no date, time or place of birth appears in it). Nothing a
family enters is used to train a model, and a family's data is deleted on request. In this demo the family lives
in `data/people.json` on the developer's machine.

## Questions for the scoping call

1. Which Bodygraph endpoint and plan?
2. Should charts be stored, or recomputed when needed?
3. What can the parent see of the prompt in the real app?
4. When a user asks about a health or safety concern, is the demo's default right, or is there wording of your own?
5. Who owns the hosting and API accounts? (Recommended: you, with the developer deploying into them.)

## What is unfinished

Nothing of the brief's priority list is cut. Each chart summary is about 47 words, not the brief's 120: the fields
the summary may use (type, strategy, authority, profile, definition, centres, channels, cross) say that much
without adding interpretation of my own.

Parvez Shah · Taraveen
