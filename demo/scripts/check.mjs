// The brief's checks 2-6 and 8 (section 10) with the spec's corrections; check 1 is `npm test` and `npx tsc
// --noEmit`, check 7 the search run on the source folder. Run from the demo folder after `npm run build`:
// node scripts/check.mjs. It starts two servers itself: port 3000 with the key from .env (any key already in the
// shell is dropped, so only .env decides), and port 3001 with an empty key (check 5(d)).
// Prints `PASS n`, `FAIL n <evidence>`, `SKIP n <why>` or `NOT RUN n <why>` per check, then the summary;
// exit 0 only with no FAIL. ONLY=5a,3 runs those checks alone (for the red runs).
import AxeBuilder from '@axe-core/playwright';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'screenshots');
const OUT = path.join(ROOT, 'check-output');
const STORE = path.join(ROOT, 'data', 'people.json');
const A = 'http://127.0.0.1:3000';
const B = 'http://127.0.0.1:3001';
const HOMEWORK = "Leo won't start his homework and every nudge turns into a fight.";
const FEVER = "Mia has had a fever for three days and she's very quiet.";
const NO_KEY = "The AI key isn't set on this machine. Everything else on this page works; the chat needs ANTHROPIC_API_KEY.";
const CHART_WORDS = ['Sacral', 'Splenic', 'Projector', 'Generator', 'authority', 'profile'];
const ORDER = ['2', '3', '4', '5a', '5b', '5c', '5d', '5e', '5f', '6', '8'];
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const REPLY_TIMEOUT = 90000;

const results = new Map();
const requests = []; // [base, url] for every request any page made
const replies = []; // the model's replies, for the plan's Proof
let key = 'unknown'; // 'ok', 'none' or 'refused <status>', from the first chat response

class Fail extends Error {}
class NotRun extends Error {}
function expect(cond, msg) {
  if (!cond) throw new Fail(msg);
}
const wants = label => !ONLY || ONLY.has(label);

async function check(label, fn) {
  if (!wants(label)) return;
  try {
    const note = await fn();
    results.set(label, `PASS ${label}${note ? ` ${note}` : ''}`);
  } catch (e) {
    if (e instanceof NotRun) results.set(label, `NOT RUN ${label} ${e.message}`);
    else results.set(label, `FAIL ${label} ${(e instanceof Fail ? e.message : e.stack || String(e)).split('\n').slice(0, 3).join(' | ')}`);
  }
}
function needKey(what) {
  if (key === 'none') throw new NotRun(`no ANTHROPIC_API_KEY in .env: ${what}`);
  if (key !== 'ok') throw new Fail(`the API refused the key (${key}): ${what}`);
}

// Servers
const servers = [];
async function serve(port, apiKey) {
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };
  delete env.ANTHROPIC_API_KEY;
  if (apiKey !== undefined) env.ANTHROPIC_API_KEY = apiKey;
  const log = fs.openSync(path.join(OUT, `server-${port}.log`), 'w');
  const child = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: ROOT,
    env,
    stdio: ['ignore', log, log],
  });
  servers.push(child);
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/people`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`server on ${port} did not start`);
}

// Pages
let browser;
async function open(base, { width = 1440, height = 900, dark = false, fresh = true, video = null } = {}) {
  if (fresh) fs.rmSync(STORE, { force: true });
  const ctx = await browser.newContext({
    viewport: { width, height },
    colorScheme: dark ? 'dark' : 'light',
    ...(video ? { recordVideo: { dir: video, size: { width, height } } } : {}),
  });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const page = await ctx.newPage();
  page.on('request', r => requests.push([base, r.url()]));
  page.setDefaultTimeout(15000);
  await page.goto(base);
  await page.waitForSelector('li[data-person="Leo"]');
  return { ctx, page };
}

const childButton = (page, name) => page.locator(`li[data-person="${name}"] button[aria-pressed]`);
const pressed = async (page, name) => (await childButton(page, name).getAttribute('aria-pressed')) === 'true';
const chip = async page => (await page.locator('[data-testid="talking-about"]').textContent()).trim();
const panel = async page => page.locator('[data-testid="prompt"]').textContent();
const narrow = page => page.viewportSize().width < 720;
async function tab(page, name) {
  if (narrow(page)) await page.click(`#tab-${name}`);
}
async function copyText(page) {
  await page.getByRole('button', { name: /^(Copy|Copied)$/ }).click();
  return page.evaluate(() => navigator.clipboard.readText());
}
const sha = text => createHash('sha256').update(text).digest('hex');

// The WebM's own length: Segment Info's Duration (ID 0x4489, a float in TimecodeScale units, default 1 ms).
function webmSeconds(file) {
  const b = fs.readFileSync(file);
  let scale = 1e6;
  const ts = b.indexOf(Buffer.from([0x2a, 0xd7, 0xb1]));
  if (ts > -1 && ts < 4096) {
    const n = b[ts + 3] & 0x0f;
    scale = Number(b.readUIntBE(ts + 4, n));
  }
  const at = b.indexOf(Buffer.from([0x44, 0x89]));
  if (at < 0 || at > 4096) return null;
  const size = b[at + 2];
  const value = size === 0x88 ? b.readDoubleBE(at + 3) : size === 0x84 ? b.readFloatBE(at + 3) : null;
  return value === null ? null : (value * scale) / 1e9;
}
async function inList(page, locator) {
  return locator.evaluate(el => {
    const list = el.closest('[aria-busy]').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return r.top >= list.top - 1 && r.top < list.bottom;
  });
}

// Sends a suggested chip, or typed text, and waits for the reply to finish. Returns the response and the reply.
async function ask(page, text, { chipped = true, onFirst = null } = {}) {
  const before = await page.locator('[data-role="user"]').count();
  const response = page.waitForResponse(r => r.url().endsWith('/api/chat'));
  if (chipped) await page.getByRole('button', { name: text, exact: true }).click();
  else {
    await page.getByLabel('Message', { exact: true }).fill(text);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
  }
  if (onFirst) await onFirst();
  const res = await response;
  if (key === 'unknown' && page.url().startsWith(A)) key = res.status() === 503 ? 'none' : res.ok() ? 'ok' : `refused ${res.status()}`;
  await page.waitForFunction(
    n => document.querySelectorAll('[data-role="user"]').length === n + 1 && document.querySelector('[data-streaming]')?.getAttribute('data-streaming') === 'false',
    before,
    { timeout: REPLY_TIMEOUT },
  );
  // The reply after this question, if one stayed (an empty one is removed). D9: its first paragraph is the raw
  // text before the first blank line.
  const last = page.locator('[data-role="user"]').last().locator('xpath=following-sibling::*[1][@data-role="assistant"]');
  const raw = (await last.count()) ? ((await last.getAttribute('data-text')) ?? (await last.innerText())) : '';
  const reply = { status: res.status(), header: res.headers()['x-prompt-sha256'], text: raw.trim(), first: raw.trim().split(/\n\s*\n/)[0] };
  if (res.ok()) replies.push({ question: text, reply: reply.text });
  return reply;
}
function noChartWords(paragraph, label) {
  const hit = CHART_WORDS.filter(w => paragraph.toLowerCase().includes(w.toLowerCase()));
  expect(!hit.length, `${label}: first paragraph names ${hit.join(', ')}: "${paragraph.slice(0, 160)}"`);
}

// Layout measures (check 3)
async function sideways(page, where) {
  const m = await page.evaluate(() => {
    const foot = document.querySelector('footer').getBoundingClientRect();
    const out = { page: document.documentElement.scrollWidth - innerWidth, 'footer below the screen': Math.ceil(foot.bottom - innerHeight) };
    for (const [k, sel] of [['prompt', '[data-testid="prompt"]'], ['messages', '[aria-busy]']]) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) out[k] = el.scrollWidth - el.clientWidth;
    }
    return out;
  });
  for (const [k, v] of Object.entries(m)) expect(v <= 0, `${where}: ${k} ${k.startsWith('footer') ? 'by' : 'scrolls sideways by'} ${v}px`);
}
async function axe(page, where) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const bad = violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  expect(!bad.length, `${where}: axe ${bad.map(v => `${v.id} (${v.nodes.length}: ${v.nodes[0].target.join(' ')})`).join('; ')}`);
}

async function addNoah(page, { slow = false } = {}) {
  await tab(page, 'family');
  await page.getByRole('button', { name: 'Add a person' }).click();
  const pause = () => (slow ? page.waitForTimeout(400) : null);
  await page.getByLabel('Name', { exact: true }).pressSequentially('Noah', { delay: slow ? 120 : 0 });
  await pause();
  await page.getByLabel('Relationship', { exact: true }).selectOption('Child');
  await page.getByLabel('Date of birth', { exact: true }).fill('2021-05-14');
  await page.getByLabel('Time of birth', { exact: true }).fill('09:30');
  await page.getByLabel('Birth place', { exact: true }).pressSequentially('Christchurch', { delay: slow ? 60 : 0 });
  await page.getByLabel('Time zone', { exact: true }).selectOption('Pacific/Auckland');
  await pause();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const card = page.locator('li[data-person="Noah"]');
  await card.waitFor();
  return card;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  if (wants('2') || wants('4')) {
    fs.rmSync(SHOTS, { recursive: true, force: true });
    fs.mkdirSync(SHOTS, { recursive: true });
  }
  await serve(3000, undefined);
  await serve(3001, '');
  browser = await chromium.launch();

  // 5(f) first: its first response also tells whether .env holds a key.
  await check('5f', async () => {
    const { ctx, page } = await open(A);
    await childButton(page, 'Mia').click();
    const alone = await copyText(page);
    expect(alone.includes('Mia, child') && !alone.includes('Leo, child'), 'Copy text with Mia alone selected does not hold Mia alone');
    const r1 = await ask(page, 'What is one small thing to try with Mia today?', { chipped: false });
    expect(r1.header === sha(alone), `Mia alone: header ${r1.header} != sha256 of the Copy text ${sha(alone)}`);
    await page.getByRole('button', { name: 'New chat' }).click();
    await page.getByRole('button', { name: 'Compare' }).click();
    await childButton(page, 'Leo').click();
    const both = await copyText(page);
    const r2 = await ask(page, 'What is one small thing to try with both of them today?', { chipped: false });
    expect(r2.header === sha(both), `Leo and Mia: header ${r2.header} != sha256 of the Copy text ${sha(both)}`);
    expect(r1.header !== r2.header, 'the two prompts hash the same');
    await ctx.close();
    return `(responses ${r1.status} and ${r2.status}; key ${key})`;
  });

  await check('5a', async () => {
    const { ctx, page } = await open(A);
    expect(await pressed(page, 'Leo'), 'Leo not selected on open');
    expect(!(await pressed(page, 'Mia')), 'Mia selected on open');
    expect((await chip(page)) === 'Talking about: Leo', `chip reads "${await chip(page)}"`);
    let p = await panel(page);
    expect(/Hannah, parent, age \d+:/.test(p) && /Leo, child, age \d+:/.test(p), 'panel lacks Hannah or Leo');
    expect(!p.includes('Mia'), 'panel holds Mia with Leo selected');
    await page.evaluate(() => (window.__noReload = 1));
    await childButton(page, 'Mia').click();
    p = await panel(page);
    expect(p.includes('Mia') && p.includes('Projector'), 'panel lacks Mia or Projector after clicking Mia');
    expect(!p.includes('Leo'), 'panel still holds Leo after clicking Mia');
    expect((await pressed(page, 'Mia')) && !(await pressed(page, 'Leo')), 'Mia is not selected alone');
    expect((await chip(page)) === 'Talking about: Mia', `chip reads "${await chip(page)}"`);
    expect((await page.evaluate(() => window.__noReload)) === 1, 'the page reloaded');
    await ctx.close();
  });

  await check('5b', async () => {
    for (const [first, second] of [['Leo', 'Mia'], ['Mia', 'Leo']]) {
      const { ctx, page } = await open(A);
      await childButton(page, first).click();
      await page.getByRole('button', { name: 'Compare' }).click();
      await childButton(page, second).click();
      expect((await pressed(page, 'Leo')) && (await pressed(page, 'Mia')), `${first} then ${second}: not both selected`);
      expect((await chip(page)) === 'Talking about: Leo and Mia', `${first} then ${second}: chip reads "${await chip(page)}"`);
      const ph = await page.getByLabel('Message', { exact: true }).getAttribute('placeholder');
      expect(ph === 'Ask about Leo and Mia…', `${first} then ${second}: placeholder "${ph}"`);
      const p = await panel(page);
      const leo = p.search(/Leo, child, age \d+:/);
      const mia = p.search(/Mia, child, age \d+:/);
      expect(leo > -1 && mia > leo, `${first} then ${second}: Leo's header at ${leo}, Mia's at ${mia}`);
      await page.getByRole('button', { name: 'Compare' }).click();
      expect((await chip(page)) === 'Talking about: Leo', `Compare off: chip reads "${await chip(page)}"`);
      await ctx.close();
    }
  });

  await check('5c', async () => {
    const { ctx, page } = await open(A);
    await childButton(page, 'Mia').click();
    for (let i = 1; i <= 3; i++) {
      await page.getByRole('button', { name: 'New chat' }).click();
      const r = await ask(page, FEVER);
      needKey('the fever replies'); // judged on the first response, so the check also stands alone
      expect(r.status === 200 && r.text, `thread ${i}: status ${r.status}, reply "${r.text.slice(0, 80)}"`);
      noChartWords(r.first, `thread ${i}`);
    }
    await ctx.close();
  });

  await check('5d', async () => {
    const { ctx, page } = await open(B);
    const r = await ask(page, 'Hello', { chipped: false });
    expect(r.status === 503, `the no-key server answered ${r.status}`);
    expect(r.text === NO_KEY, `the chat shows "${r.text.slice(0, 120)}"`);
    await childButton(page, 'Mia').click();
    expect((await panel(page)).includes('Projector'), 'selection does not change the panel without a key');
    const card = await addNoah(page);
    expect((await card.textContent()).includes('Manifestor · Emotional · 2/4'), 'Noah has no generic chart line');
    await card.getByRole('button', { name: 'Remove Noah' }).click();
    await page.locator('li[data-person="Noah"]').waitFor({ state: 'detached' });
    await ctx.close();
  });

  await check('5e', async () => {
    const { ctx, page } = await open(A);
    await childButton(page, 'Mia').click();
    await page.getByRole('button', { name: 'Remove Mia' }).click();
    await page.locator('li[data-person="Mia"]').waitFor({ state: 'detached' });
    expect(!(await panel(page)).includes('Mia'), 'Mia is still in the panel');
    expect(await pressed(page, 'Leo'), 'Leo is not selected after Mia, the selected child, was removed');
    await page.reload();
    await page.waitForSelector('li[data-person="Leo"]');
    expect(!(await page.locator('li[data-person="Mia"]').count()), 'Mia is back after a reload');
    await ctx.close();
  });

  await check('2', async () => {
    const shots = [];
    const shoot = async (page, name) => {
      await page.screenshot({ path: path.join(SHOTS, name) });
      shots.push(name);
    };
    const chatShot = async (opts, name) => {
      const { ctx, page } = await open(A, opts);
      if (name === 'family-390.png') {
        await shoot(page, name);
        await tab(page, 'chat');
      } else await tab(page, 'chat');
      const r = await ask(page, HOMEWORK);
      if (name === 'family-390.png') {
        await shoot(page, 'chat-390.png');
        await tab(page, 'prompt');
        await shoot(page, 'prompt-390.png');
      } else await shoot(page, name);
      await ctx.close();
      return r;
    };
    const got = [
      await chatShot({ width: 390, height: 844 }, 'family-390.png'),
      await chatShot({ width: 1440, height: 900 }, 'desktop-1440.png'),
      await chatShot({ width: 390, height: 844, dark: true }, 'chat-390-dark.png'),
    ];
    const want = ['family-390.png', 'chat-390.png', 'prompt-390.png', 'desktop-1440.png', 'chat-390-dark.png'];
    expect(want.every(f => fs.statSync(path.join(SHOTS, f)).size > 0), `screenshots: ${shots.join(', ')}`);
    needKey('5 screenshots saved, with the no-key message where the replies would be');
    for (const r of got) expect(r.status === 200 && r.text.length > 40, `a screenshot's reply: status ${r.status}, "${r.text.slice(0, 80)}"`);
    return `(${want.join(', ')})`;
  });

  await check('3', async () => {
    for (const dark of [false, true]) {
      for (const width of [360, 390, 768, 1024, 1440]) {
        const where = `${width}${dark ? ' dark' : ''}`;
        const { ctx, page } = await open(B, { width, height: width < 720 ? 844 : 900, dark });
        await tab(page, 'chat');
        await ask(page, 'Hello', { chipped: false });
        await page.getByLabel('Message', { exact: true }).fill(HOMEWORK);
        await tab(page, 'family');
        await page.getByRole('button', { name: 'Add a person' }).click();
        for (const t of narrow(page) ? ['family', 'chat', 'prompt'] : ['all']) {
          if (t !== 'all') await tab(page, t);
          await sideways(page, `${where} ${t}`);
          if (width === 390 || width === 1440) await axe(page, `${where} ${t}`);
        }
        if (width >= 720 && width < 1024) {
          await page.getByRole('button', { name: 'What the AI knows' }).click();
          await sideways(page, `${where} drawer`);
        }
        await ctx.close();
      }
    }
  });

  await check('4', async () => {
    const dir = path.join(OUT, 'video');
    fs.rmSync(dir, { recursive: true, force: true });
    const t0 = Date.now();
    const { ctx, page } = await open(A, { video: dir });
    const beat = ms => page.waitForTimeout(ms);
    const notes = [];
    // Paced for a viewer (source:159): about 75 s, most of it on the two replies.
    const TARGET = 75000;
    const CP7_AND_END = 11000;
    const clamp = (ms, lo, hi) => Math.max(lo, Math.min(hi, ms));
    // CP1
    expect((await pressed(page, 'Leo')) && (await chip(page)) === 'Talking about: Leo', 'CP1: Leo not selected');
    expect(!(await panel(page)).includes('Mia'), 'CP1: panel holds Mia');
    await beat(2500);
    // CP2: scroll the panel until `Manifesting Generator` is in view inside it.
    const inView = await page.evaluate(() => {
      const pane = document.getElementById('prompt-pane');
      const pre = pane.querySelector('pre[data-section="family"]');
      const node = [...pre.childNodes].find(n => n.textContent.includes('Manifesting Generator'));
      const range = document.createRange();
      const at = node.textContent.indexOf('Manifesting Generator');
      range.setStart(node, at);
      range.setEnd(node, at + 'Manifesting Generator'.length);
      const r = range.getBoundingClientRect();
      const box = pane.getBoundingClientRect();
      pane.scrollTo({ top: pane.scrollTop + r.top - box.top - box.height / 3, behavior: 'smooth' });
      return new Promise(done =>
        setTimeout(() => {
          const r2 = range.getBoundingClientRect();
          const b2 = pane.getBoundingClientRect();
          done(r2.top >= b2.top && r2.bottom <= b2.bottom);
        }, 900),
      );
    });
    expect(inView, 'CP2: Manifesting Generator is not in view inside the panel');
    await beat(2200);
    // CP3
    await childButton(page, 'Mia').click();
    await beat(400);
    const p3 = await panel(page);
    expect(p3.includes('Projector') && !p3.includes('Leo') && (await chip(page)) === 'Talking about: Mia', 'CP3: panel or chip not on Mia');
    await beat(2500);
    // CP4
    await page.getByRole('button', { name: 'Compare' }).click();
    await beat(1200);
    await childButton(page, 'Leo').click();
    expect((await chip(page)) === 'Talking about: Leo and Mia', `CP4: chip reads "${await chip(page)}"`);
    await beat(2800);
    // CP5
    let dot = false;
    const s5 = Date.now();
    const r5 = await ask(page, HOMEWORK, {
      onFirst: async () => {
        dot = await page
          .locator('[aria-label="Typing"]')
          .waitFor({ state: 'visible', timeout: 3000 })
          .then(() => true, () => false);
      },
    });
    const stream5 = Date.now() - s5;
    const reply5 = page.locator('[data-role="assistant"]').last();
    const shown5 = (await reply5.count()) ? await inList(page, reply5) : false;
    // Hold so both replies get the time left, split evenly; CP6's stream is taken as long as CP5's.
    await beat(clamp((TARGET - (Date.now() - t0) - 1200 - stream5 - CP7_AND_END) / 2, 6000, 16000));
    // CP6
    await page.getByRole('button', { name: 'New chat' }).click();
    await beat(1200);
    const r6 = await ask(page, FEVER);
    const reply6 = page.locator('[data-role="assistant"]').last();
    const shown6 = (await reply6.count()) ? await inList(page, reply6) : false;
    await beat(clamp(TARGET - (Date.now() - t0) - CP7_AND_END, 6000, 18000));
    // CP7
    const card = await addNoah(page, { slow: true });
    const text = await card.textContent();
    expect(/Child · age \d+/.test(text) && text.includes('Manifestor · Emotional · 2/4'), `CP7: Noah's card reads "${text}"`);
    const anim = await card.evaluate(el => [getComputedStyle(el).animationName, getComputedStyle(el).animationDuration]);
    expect(anim[0] !== 'none' && anim[1] === '0.15s', `CP7: the new card's highlight is ${anim.join(' ')}`);
    await beat(2500);
    // Only a take without replies can still be short here; it is not the client's video.
    const left = 60500 - (Date.now() - t0);
    if (left > 0) await beat(left);
    const wall = (Date.now() - t0) / 1000;
    await ctx.close();
    const file = path.join(SHOTS, 'demo.webm');
    await page.video().saveAs(file);
    const seconds = webmSeconds(file) ?? wall;
    notes.push(`video ${seconds.toFixed(1)} s (${webmSeconds(file) === null ? 'wall clock' : "the file's Duration"}), screenshots/demo.webm; no ffmpeg on this machine, so no demo.mp4`);
    expect(seconds >= 60 && seconds <= 90, `the video runs ${seconds.toFixed(1)} s`);
    needKey(`replies not shown in the video; ${notes.join('; ')}`);
    expect(r5.status === 200 && r5.text, `CP5: status ${r5.status}`);
    expect(dot, 'CP5: no typing dot before the first text');
    expect(shown5, 'CP5: the reply\'s start is not in view in the message list');
    expect(r6.status === 200 && r6.text, `CP6: status ${r6.status}`);
    expect(shown6, 'CP6: the reply\'s first paragraph is not in view in the message list');
    noChartWords(r6.first, 'CP6');
    return `(${notes.join('; ')})`;
  });

  await check('6', async () => {
    const { ctx, page } = await open(A); // a page of its own, so the check judges even when run alone
    await page.waitForTimeout(1500);
    await ctx.close();
    const off = requests.filter(([base, url]) => /^https?:/.test(url) && new URL(url).origin !== base);
    expect(requests.length > 0, 'no requests were recorded');
    expect(!off.length, `requests off the page's origin: ${[...new Set(off.map(([, u]) => u))].slice(0, 5).join(', ')}`);
    return `(${requests.length} requests, all to the page's own origin)`;
  });

  await check('8', async () => {
    const log = fs.readFileSync(path.join(ROOT, 'WORK_LOG.md'), 'utf8').split('\n');
    const rows = log.filter(l => /^\|\s*\d{4}-\d{2}-\d{2}/.test(l));
    expect(rows.length > 0, 'WORK_LOG.md has no session rows');
    expect(rows.some(r => /AI agent/.test(r) && /\d{2}:\d{2}.*\d{2}:\d{2}/.test(r)), 'no AI agent row with start and end times');
    expect(log.some(l => /^\*\*Totals?\b|^Totals?\b|^\|\s*\*\*Totals?/i.test(l)), 'WORK_LOG.md has no totals');
    return `(${rows.length} session rows)`;
  });
}

try {
  await main();
} catch (e) {
  console.log(`check.mjs stopped: ${e.stack || e}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const s of servers) s.kill();
  fs.rmSync(STORE, { force: true });
  fs.writeFileSync(path.join(OUT, 'replies.md'), replies.map(r => `## ${r.question}\n\n${r.reply}\n`).join('\n'));
}

let passed = 0, failed = 0, skipped = 0, notRun = 0;
for (const label of ORDER) {
  const line = results.get(label);
  if (!line) continue;
  console.log(line);
  if (line.startsWith('PASS')) passed++;
  else if (line.startsWith('FAIL')) failed++;
  else if (line.startsWith('SKIP')) skipped++;
  else notRun++;
}
console.log(`checks: ${passed} passed, ${failed} failed, ${skipped} skipped, ${notRun} not run`);
if (failed) process.exitCode = 1;
