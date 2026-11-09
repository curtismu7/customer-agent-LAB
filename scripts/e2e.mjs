#!/usr/bin/env node
// Real-browser run of the web UI against the real server, which serves the UI itself (server/src/index.js).
//
//   npm run build          (once; the server serves web/dist)
//   npm run e2e            starts the server on E2E_PORT (default 5690), drives it in Chromium, stops it
//   E2E_SHOTS=/some/dir    where screenshots go (default .data/e2e-screenshots, git-ignored)
//
// Uses the Chromium the installed Playwright resolves (`npx playwright install chromium` if it is missing). The run makes no outbound request: any
// request to another origin fails the run. Exit 0 only when every check passes.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { CLIENT_ID, CLIENT_SECRET, FAKE_TOKEN, settingsFor, startFakePingOne } from '../server/test/fakePingone.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.E2E_SHOTS || path.join(root, '.data', 'e2e-screenshots');
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
let failures = 0; let checks = 0;
const check = (ok, what) => { checks += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failures += 1; };

const port = Number(process.env.E2E_PORT) || 5690;
if (port < 5603 || port > 5699) { console.error('E2E_PORT must be inside 5603-5699'); process.exit(2); }
const base = `http://127.0.0.1:${port}`;
if (!fs.existsSync(path.join(root, 'web', 'dist', 'index.html'))) { console.error('Run `npm run build` first.'); process.exit(2); }
const env = { ...process.env, PORT: String(port), ALLOW_MOCK_SIGNIN: '1', IDP: 'mock' };
delete env.CALAB_BIND; delete env.CAL_ALLOW_LIVE; delete env.CAL_LAB_MODE;
const server = spawn(process.execPath, ['server/src/index.js'], { cwd: root, env, stdio: 'inherit' });
let up = false;
for (let i = 0; i < 160 && !up; i++) { try { up = (await fetch(`${base}/api/health`)).ok; } catch { await sleep(250); } }
if (!up) { server.kill(); console.error('server did not start'); process.exit(2); }
fs.mkdirSync(shots, { recursive: true });

const overlapScript = `(() => {
  const labels = [...document.querySelectorAll('.react-flow__edgelabel-renderer > *')].map((el) => ({ t: el.textContent.trim(), r: el.getBoundingClientRect() })).filter((l) => l.t && l.r.width > 1);
  let overlaps = 0;
  for (let a = 0; a < labels.length; a++) for (let b = a + 1; b < labels.length; b++) {
    const w = Math.min(labels[a].r.right, labels[b].r.right) - Math.max(labels[a].r.left, labels[b].r.left);
    const h = Math.min(labels[a].r.bottom, labels[b].r.bottom) - Math.max(labels[a].r.top, labels[b].r.top);
    const small = Math.min(labels[a].r.width * labels[a].r.height, labels[b].r.width * labels[b].r.height) || 1;
    if (w > 0 && h > 0 && (w * h) / small > 0.08) overlaps++;
  }
  return { labels: labels.length, overlaps };
})()`;

// Live mode (step 3) is driven against a FAKE PingOne on loopback: a second lab instance with the owner's opt-in, a temp settings file (mode 600, fake values)
// and CAL_LIVE_TEST_BASE pointing at the fake. No real tenant is touched; the real PingOne path is UNVERIFIED and owner-run.
const livePort = port + 1;
const liveBase = `http://127.0.0.1:${livePort}`;
const fake = await startFakePingOne();
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-e2e-'));
const settingsFile = path.join(settingsDir, '.env');
fs.writeFileSync(settingsFile, `${Object.entries(settingsFor()).map(([k, v]) => `${k}=${v}`).join('\n')}\n`, { mode: 0o600 });
const liveEnv = { ...process.env, PORT: String(livePort), IDP: 'pingone', CAL_ALLOW_LIVE: '1', STANDALONE_ENV: settingsFile, CAL_LIVE_TEST_BASE: fake.base };
delete liveEnv.CALAB_BIND; delete liveEnv.CAL_LAB_MODE; delete liveEnv.ALLOW_MOCK_SIGNIN;
const liveServer = spawn(process.execPath, ['server/src/index.js'], { cwd: root, env: liveEnv, stdio: 'inherit' });
let liveUp = false;
for (let i = 0; i < 160 && !liveUp; i++) { try { liveUp = (await fetch(`${liveBase}/api/health`)).ok; } catch { await sleep(250); } }
if (!liveUp) { server.kill(); liveServer.kill(); console.error('live server did not start'); process.exit(2); }

const healthOf = async (b) => (await (await fetch(`${b}/api/health`)).json()).runtime;
check((await healthOf(liveBase)) === 'live' && (await healthOf(base)) === 'offline', 'health: the live instance reports runtime live, the mock one offline');

let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM || undefined });
  for (const [width, height, name] of [[1280, 900, 'desktop'], [375, 800, 'phone']]) {
    for (const scheme of ['light', 'dark']) {
      const tag = `${name}-${scheme}`;
      const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
      const page = await ctx.newPage();
      const external = []; const errors = []; const requests = [];
      page.on('request', (r) => { requests.push(r.url()); if (!r.url().startsWith(base) && !/^(data|blob):/.test(r.url())) external.push(r.url()); });
      page.on('pageerror', (e) => errors.push(e.message));
      // the deliberate refusals (403 live, 409 Real refused, 501 stub) show up as console messages; anything else is a failure
      page.on('console', (m) => { if (m.type() === 'error' && !/status of (403|409|501)/.test(m.text())) errors.push(m.text()); });
      const t = (id) => page.getByTestId(id);
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const pick = async (id) => { await t('search').fill(id); await page.locator(`[data-testid="uc-${id}"]`).click(); await t('search').fill(''); };

      await page.goto(`${base}/`);
      await t('uc-UC1').waitFor();
      // the banner says both modes until the story has loaded; wait for it to settle on the mode before reading it
      await page.waitForFunction(() => document.querySelector('[data-testid="banner"]').textContent.startsWith('SIMULATED, MOCK mode'), null, { timeout: 60000 }).catch(() => {});
      check((await t('banner').innerText()).startsWith('SIMULATED, MOCK mode'), `${tag}: the banner says SIMULATED, MOCK mode`);
      check((await t('mode').innerText()).includes('Mode: mock'), `${tag}: the header shows Mode: mock`);
      check(/^Workspace: w-[0-9a-f]{16}$/.test(await t('workspace').innerText()), `${tag}: the header shows the workspace id`);
      check((await page.getByRole('tab').allInnerTexts()).join('|') === 'Agent|Run history|Diagram|Talk track', `${tag}: the side nav holds only the agent's own areas`);
      check((await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === null, `${tag}: Auto theme sets no data-theme`);
      if (width < 600) {
        const top = await page.evaluate(() => Math.round(document.querySelector('main').getBoundingClientRect().top + window.scrollY));
        console.log(`INFO  ${tag}: the content starts ${top} px from the top`);
        check(top < 480, `${tag}: the header leaves the content to start above 480 px (${top})`);
        const nav = await page.evaluate(() => { const l = document.querySelector('[data-testid="nav"]'); return { sw: l.scrollWidth, cw: l.clientWidth }; });
        check(nav.sw <= nav.cw, `${tag}: all four nav tabs fit with no clipping (${nav.sw} of ${nav.cw})`);
      }

      await pick('UC1'); await t('run').click(); await t('result').waitFor();
      check((await t('outcome').innerText()) === 'PERMIT' && (await t('matches').innerText()).includes('matches the catalog label'), `${tag}: UC1 runs, PERMIT, engine matches the catalog label`);
      check((await t('hop').count()) === 21 && (await t('hop-verdict').filter({ hasText: /^skip$/ }).count()) === 5 && (await t('hops-count').innerText()) === 'Hops (16, +5 not in this run)', `${tag}: 16 hops that ran, then 5 not in this path (AI-DEMO2's reel order); the count says so`);
      check(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/.test(await t('run-traceparent').innerText()), `${tag}: the run has a W3C traceparent`);
      if (name === 'phone') {
        await t('actor-gateway').scrollIntoViewIfNeeded(); await t('actor-gateway').click();
        const sheet = page.getByRole('dialog', { name: 'Gateway actor details' });
        const sb = await sheet.boundingBox();
        check((await sheet.getAttribute('data-narrow')) === 'true' && Math.round(sb.width) === width && Math.round(sb.y + sb.height) === height, `${tag}: on a phone the actor card is a full-width bottom sheet (${Math.round(sb.width)} px)`);
        await sheet.getByRole('button', { name: 'Close Gateway details' }).click();
      }
      const token = t('token').first();
      check((await token.getByTestId('mock-tag').innerText()) === 'MOCK' && /^eyJ/.test(await token.getByTestId('token-raw').innerText()) && (await token.getByTestId('token-claims').innerText()).includes('"sub"'), `${tag}: the token is labelled MOCK, shown raw and decoded`);
      check((await t('nav-page-consent').count()) === 1, `${tag}: UC1 brought in the Consent and step-up page`);
      await pick('UC7'); await t('run').click(); await t('result').waitFor();
      check((await t('outcome').innerText()) === 'STEP_UP' && (await t('nav-page-approval').count()) === 1, `${tag}: UC7 is STEP_UP and brings in Human approval`);
      // The persona the engine needs is selected by the use case itself: the default Run of UC21 permits and UC9 denies, as the README says.
      await pick('UC21');
      check((await t('persona').inputValue()) === 'premium', `${tag}: picking UC21 selects the premium persona it needs`);
      await t('run').click(); await t('result').waitFor();
      check((await t('outcome').innerText()) === 'PERMIT' && (await t('matches').innerText()).includes('matches the catalog label'), `${tag}: UC21 with its default persona is PERMIT and matches the catalog label`);
      await pick('UC9');
      check((await t('persona').inputValue()) === 'standard', `${tag}: picking UC9 selects the standard persona`);
      await t('run').click(); await t('result').waitFor();
      check((await t('outcome').innerText()) === 'DENY_403' && (await t('matches').innerText()).includes('matches the catalog label'), `${tag}: UC9 with its default persona is DENY_403 and matches the catalog label`);
      // keyboard and landmarks: focus stays on Run, one main landmark holding the tabpanel, no dangling aria-controls, Cmd/Ctrl+P is not presenter mode
      await t('run').focus(); await page.keyboard.press('Enter');
      check((await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))) === 'run', `${tag}: focus stays on the Run button after Enter`);
      await t('result').waitFor(); await sleep(150);
      check((await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))) === 'run', `${tag}: focus is still on Run when the result lands`);
      check((await page.getByRole('main').count()) === 1 && (await page.getByRole('main').getByRole('tabpanel').count()) === 1, `${tag}: one main landmark, with the tabpanel inside it`);
      check((await page.evaluate(() => [...document.querySelectorAll('[aria-controls]')].filter((e) => !document.getElementById(e.getAttribute('aria-controls'))).length)) === 0, `${tag}: no aria-controls points at a missing element`);
      await page.keyboard.press('Control+p'); await page.keyboard.press('Meta+p');
      check((await t('presenter').getAttribute('aria-pressed')) === 'false', `${tag}: Ctrl+P and Cmd+P do not toggle presenter mode`);
      check((await t('run-announce').innerText()).startsWith('UC9 finished: DENY_403'), `${tag}: the live region holds the outcome line only`);
      await pick('UC-LEARN2'); await t('run').click(); await t('guided-note').waitFor();
      check((await t('guided-note').innerText()) === 'guided, not computed' && (await t('matches').count()) === 0, `${tag}: a guided run says guided, not computed`);
      // the one link allowed is the shared Shelf button in the header (a.shelf-link, the family's launcher); link-outs are plain labels
      check((await page.locator('a[href]:not(.shelf-link)').count()) === 0 && (await page.locator('a.shelf-link').count()) <= 1 && (await page.locator('.shell-bar a.shelf-link').count()) === (await page.locator('a.shelf-link').count()), `${tag}: no link anywhere but the header Shelf button (link-outs are plain labels)`);
      await t('nav-more').selectOption('page-approval'); await t('extra-approval').waitFor();
      check((await overflow()) <= 0, `${tag}: the extra page does not scroll sideways (${await overflow()} px)`);
      await t('nav-agent').click();
      await t('vertical').selectOption('government'); await pick('UC1'); await t('run').click(); await t('refusal').waitFor();
      check((await t('refusal').getAttribute('data-code')) === 'vertical_stub' && (await t('refusal').innerText()).includes('Not built'), `${tag}: a stub vertical shows the honest not built state (HTTP 501)`);
      await t('vertical').selectOption('banking');
      await t('mode-live').click(); await t('mode-msg').waitFor();
      check((await t('mode-msg').innerText()).includes('refused') && (await t('mode').innerText()).includes('mock'), `${tag}: Live is refused with the server's message and stays Mock`);
      check((await overflow()) <= 0, `${tag}: the agent page does not scroll sideways (${await overflow()} px)`);
      if (tag === 'desktop-light') await page.screenshot({ path: path.join(shots, 'run.png'), fullPage: true });

      await t('nav-runs').click(); await t('history').waitFor();
      check((await t('history-row').count()) >= 3, `${tag}: run history lists the runs`);

      await t('nav-diagram').click();
      const before = requests.length;
      for (const dn of ['delegation-chain', 'gateway-refusals']) {
        await t(`dg-${dn}`).click(); await page.locator('.react-flow__node').first().waitFor(); await sleep(600);
        const o = await page.evaluate(overlapScript);
        check(o.overlaps === 0 && o.labels === 6, `${tag}: ${dn} has ${o.labels} labels and ${o.overlaps} overlaps`);
        check((await overflow()) <= 0, `${tag}: the diagram page does not scroll sideways`);
      }
      check(requests.slice(before).some((u) => u.includes('/api/diagram?') && u.includes('name=gateway-refusals')), `${tag}: the diagram was loaded by name from the server`);
      await t('dg-delegation-chain').click(); await page.locator('.react-flow__node').first().waitFor(); await sleep(600);
      if (width < 600) {
        check(await t('diagram-hint').isVisible(), `${tag}: the diagram says it is wider than the screen and how to pan`);
        const fit = await page.evaluate(() => {
          const c = document.querySelector('[data-testid="diagram-canvas"]').getBoundingClientRect();
          return [...document.querySelectorAll('.react-flow__node')].slice(0, 2).map((n) => { const r = n.getBoundingClientRect(); return r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom; });
        });
        check(fit.length === 2 && fit.every(Boolean), `${tag}: the first view shows the first two boxes whole (${fit.join(',')})`);
        console.log(`INFO  ${tag}: first-view node font ${await page.evaluate(() => { const n = document.querySelector('.react-flow__node .dnode'); const z = Number(/matrix\(([^,]+)/.exec(getComputedStyle(document.querySelector('.react-flow__viewport')).transform)?.[1] || 1); return `${(parseFloat(getComputedStyle(n).fontSize) * z).toFixed(1)}px on screen (zoom ${z.toFixed(2)})`; })}`);
      } else check(!(await t('diagram-hint').isVisible()), `${tag}: the pan hint is for phones only`);
      if (tag === 'desktop-dark') await page.screenshot({ path: path.join(shots, 'diagram-dark.png'), fullPage: true });
      await t('speed').selectOption('800'); await t('simulate').click(); await t('diagram-now').waitFor(); await sleep(1100);
      check(/Step [2-6]:/.test(await t('diagram-now').innerText()), `${tag}: Simulate advances at the chosen speed`);
      await t('diagram-reset').click();
      const box = await page.locator('.react-flow__node').first().boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 5 }); await page.mouse.up();
      check((await t('diagram-moved').innerText()).includes('Moved: 1 box'), `${tag}: a box can be moved`);
      await t('diagram-reset').click(); await sleep(200);
      check((await t('diagram-moved').innerText()).includes('Moved: 0 box'), `${tag}: Reset restores the box positions`);

      await t('theme').selectOption('dark');
      check((await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark', `${tag}: the theme picker sets data-theme=dark`);
      await t('theme').selectOption('auto');
      check((await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === null, `${tag}: the theme picker back on Auto clears data-theme`);
      await t('nav-agent').click(); await page.keyboard.press('p'); await t('presenter-say').waitFor();
      check((await t('nav').count()) === 0 && (await t('banner').isVisible()), `${tag}: presenter mode hides the nav and keeps the banner`);
      check((await overflow()) <= 0, `${tag}: presenter mode does not scroll sideways (${await overflow()} px)`);
      check((await page.locator('main').boundingBox()).width > width * 0.8, `${tag}: presenter mode gives the content the full width`);
      await page.keyboard.press('Escape'); await t('nav').waitFor();

      await t('reset').click(); await sleep(500);
      check((await t('nav-page-consent').count()) === 0 && (await t('nav-page-approval').count()) === 0, `${tag}: Reset removed the extra pages`);
      await t('nav-runs').click(); await t('history-empty').waitFor();
      check(true, `${tag}: Reset emptied the run history`);
      check(external.length === 0, `${tag}: no request to another origin (${external.length})`);
      check(errors.length === 0, `${tag}: no unexpected console error (${errors.slice(0, 2).join(' | ')})`);
      await ctx.close();
    }
  }

  // ---- The agent page layout (Step 1 review): three columns, fitted sequence, hand-off in the conversation, What to type, one-row header ----
  for (const [width, height] of [[1280, 900], [1440, 900], [1600, 900]]) {
    for (const scheme of ['light', 'dark']) {
      const tag = `agent-${width}-${scheme}`;
      const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error' && !/status of (403|409|501)/.test(m.text())) errors.push(m.text()); });
      const t = (id) => page.getByTestId(id);
      const rect = (sel) => page.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height } : null; }, sel);
      // every direct part of the shell bar sits on one row: their vertical ranges all overlap
      const oneRow = () => page.evaluate(() => {
        const parts = [...document.querySelectorAll('.shell-bar > *')].map((e) => e.getBoundingClientRect()).filter((r) => r.height > 0);
        return parts.every((a) => parts.every((b) => a.top < b.bottom && b.top < a.bottom));
      });
      await page.goto(`${base}/`);
      await t('wtt-UC1').waitFor();
      await t('theme').selectOption(scheme);
      check(await oneRow(), `${tag}: the shell bar is one row`);
      const wtt = await t('what-to-type').innerText();
      check((await t('wtt-heading').innerText()).toUpperCase() === 'WHAT TO TYPE · BANKING · FABRIKAM BANK' && wtt.includes('show my balance'), `${tag}: What to type names the vertical and lists its prompts`);
      check((await t('wtt-away').getByRole('button').count()) >= 1 && wtt.toLowerCase().includes('opens its own app'), `${tag}: What to type has an Opens its own app group`);

      await t('wtt-UC1').click(); await t('turn-answer').waitFor(); await sleep(300);
      const [side, agent, ev] = [await rect('.setup'), await rect('.agentcol'), await rect('.evcol')];
      check(Math.abs(side.t - agent.t) < 2 && Math.abs(agent.t - ev.t) < 2 && side.r <= agent.l && agent.r <= ev.l, `${tag}: sidebar | agent | evidence side by side (lefts ${Math.round(side.l)}, ${Math.round(agent.l)}, ${Math.round(ev.l)})`);
      check(agent.w >= 370 && agent.w <= 480 && ev.w > agent.w, `${tag}: agent column ${Math.round(agent.w)} px (380-470), evidence wider (${Math.round(ev.w)} px)`);
      const fit = () => page.evaluate(() => {
        const sc = document.querySelector('.sq-scroll'); const box = sc.getBoundingClientRect();
        const lanes = [...sc.querySelectorAll('.sq-lane')].map((g) => g.getBoundingClientRect());
        return { sw: sc.scrollWidth, cw: sc.clientWidth, zoom: document.querySelector('[data-testid="sequence-svg"]').getAttribute('data-zoom'), lanes: lanes.length, inside: lanes.every((r) => r.left >= box.left - 1 && r.right <= box.right + 1) };
      });
      let f = await fit();
      check(f.zoom === 'fit' && f.sw <= f.cw && f.lanes >= 4 && f.inside, `${tag}: the embedded sequence fits at the default zoom (${f.lanes} lanes, ${f.sw} of ${f.cw} px, all in view)`);
      await page.getByRole('button', { name: 'Zoom in' }).click(); await page.getByRole('button', { name: 'Zoom in' }).click();
      check((await page.getByTestId('sequence-svg').getAttribute('data-zoom')) !== 'fit', `${tag}: + overrides the fit`);
      await t('seq-fit').click(); f = await fit();
      check(f.zoom === 'fit' && f.sw <= f.cw, `${tag}: Fit returns to the fitted view`);
      check(await oneRow(), `${tag}: the shell bar is still one row with the More menu (${await t('nav-more').count()})`);

      // the actor card is a FloatingDialog (owner 2026-11-09): drag it by the title bar, it has Pop out, and the pop-out is a live same-origin window
      await t('actor-gateway').click();
      const card = page.getByRole('dialog', { name: 'Gateway actor details' });
      await card.waitFor();
      check(await card.getByRole('button', { name: 'Pop out to a new window' }).isVisible(), `${tag}: the actor card has a Pop out button`);
      const before = await card.boundingBox();
      const bar = card.getByTestId('fd-titlebar').locator('.fd-title');
      const b = await bar.boundingBox();
      await page.mouse.move(b.x + 20, b.y + b.height / 2); await page.mouse.down();
      await page.mouse.move(b.x - 100, b.y + b.height / 2 + 80, { steps: 6 }); await page.mouse.up();
      const after = await card.boundingBox();
      check(Math.round(before.x - after.x) === 120 && Math.round(after.y - before.y) === 80, `${tag}: the actor card drags by its title bar (moved ${Math.round(after.x - before.x)}, ${Math.round(after.y - before.y)})`);
      await card.getByTestId('fd-titlebar').focus(); await page.keyboard.press('ArrowRight');
      check(Math.round((await card.boundingBox()).x - after.x) === 10, `${tag}: arrow keys on the focused title bar move the card`);
      if (width === 1280) await page.screenshot({ path: path.join(shots, `actor-card-${scheme}.png`) });
      if (width === 1280) {
        const [pop] = await Promise.all([page.waitForEvent('popup'), card.getByRole('button', { name: 'Pop out to a new window' }).click()]);
        await pop.getByRole('dialog', { name: 'Gateway actor details' }).waitFor();
        check(pop.url() === 'about:blank' && (await pop.getByTestId('actor-card').innerText()).includes('Checks every call'), `${tag}: Pop out opens a same-origin blank window showing the card`);
        check((await t('fd-placeholder').innerText()).includes('open in a separate window') && (await page.getByRole('dialog').count()) === 0, `${tag}: the page shows the placeholder while the card is popped out`);
        check(await pop.evaluate(() => getComputedStyle(document.querySelector('.fd-popout-layout')).display === 'flex'), `${tag}: the popped-out window has the page's stylesheets`);
        await pop.close(); await card.waitFor();
        check((await t('fd-placeholder').count()) === 0, `${tag}: closing the window brings the card back into the page`);
        const [pop2] = await Promise.all([page.waitForEvent('popup'), card.getByRole('button', { name: 'Pop out to a new window' }).click()]);
        await pop2.getByRole('dialog', { name: 'Gateway actor details' }).waitFor();
        check(await pop2.evaluate(() => document.activeElement?.classList.contains('fd-popout-layout')), `${tag}: the popped-out card has focus`);
        const closed = pop2.waitForEvent('close', { timeout: 5000 }).catch(() => {});
        await pop2.keyboard.press('Escape').catch(() => {}); await closed; // the window closes mid-press
        check(pop2.isClosed() && (await page.getByRole('dialog').count()) === 0 && (await t('fd-placeholder').count()) === 0, `${tag}: Escape in the popup, with nothing clicked there, closes it and the card`);
        await t('actor-gateway').click(); await card.waitFor();
      }
      await page.keyboard.press('Escape');
      check((await page.getByRole('dialog').count()) === 0, `${tag}: Escape closes the actor card`);
      await t('wtt-UC7').click(); await t('turn-approval').waitFor();
      check(await oneRow(), `${tag}: the shell bar is still one row after a second extra page`);
      check((await page.evaluate(() => [...document.querySelectorAll('[data-testid="nav-more"] option')].length)) === 3, `${tag}: both extra pages are in the More menu`);
      if (scheme === 'light') await page.screenshot({ path: path.join(shots, `agent-${width}.png`) });

      // a hand-off chip: the reply shows the reasoning and the card in the conversation, in view, and the status reads Ready to hand off
      const visibleCard = () => page.evaluate(() => {
        const cards = document.querySelectorAll('[data-testid="turn"] [data-testid="handoff-card"]'); const c = cards[cards.length - 1];
        if (!c) return { ok: false };
        const r = c.getBoundingClientRect(); const box = c.closest('.agentcol__scroll').getBoundingClientRect();
        return { ok: r.top >= box.top - 1 && r.bottom <= box.bottom + 1 && r.bottom <= window.innerHeight, top: Math.round(r.top), bottom: Math.round(r.bottom), box: [Math.round(box.top), Math.round(box.bottom)] };
      });
      await t('wtt-away').getByRole('button').first().click(); await sleep(300);
      let v = await visibleCard();
      check(v.ok, `${tag}: a hand-off chip shows the hand-off card in the conversation, in view without scrolling (${v.top}-${v.bottom} in ${v.box})`);
      check((await page.getByTestId('turn').last().getByTestId('turn-reasoning').innerText()).includes('runs in its own app'), `${tag}: the hand-off reply carries its reasoning`);
      check((await t('agent-status').innerText()) === 'Ready to hand off', `${tag}: the agent status reads Ready to hand off`);
      await t('search').fill('UC2.6'); await t('uc-UC2.6').click(); await t('search').fill(''); await sleep(300);
      v = await visibleCard();
      check(v.ok && (await page.getByTestId('turn').last().getByTestId('turn-said').innerText()).startsWith('UC2.6'), `${tag}: a hand-off picked in the sidebar answers in the conversation with the card in view`);
      if (scheme === 'light') await page.screenshot({ path: path.join(shots, `agent-${width}-handoff.png`) });
      check((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, `${tag}: the agent page does not scroll sideways`);

      await t('full-sequence').click(); await t('page-sequence').waitFor();
      if (!(await t('sequence-view').count())) { await page.getByTestId('uc-UC1').click(); await t('sequence-view').waitFor(); }
      f = await fit();
      check(f.zoom === 'fit' && f.sw <= f.cw && f.inside, `${tag}: the full-page sequence fits at the default zoom (${f.sw} of ${f.cw} px)`);
      check(errors.length === 0, `${tag}: no unexpected console error (${errors.slice(0, 2).join(' | ')})`);
      await ctx.close();
    }
  }

  // ---- Live mode against the fake PingOne -------------------------------------------------------------------------------------------
  for (const [width, height, name] of [[1280, 900, 'desktop'], [375, 800, 'phone']]) {
    for (const scheme of ['light', 'dark']) {
      const tag = `live-${name}-${scheme}`;
      fake.seen.length = 0; fake.state.behaviour = 'ok';
      const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
      const page = await ctx.newPage();
      const external = []; const errors = [];
      page.on('request', (r) => { if (!r.url().startsWith(liveBase) && !/^(data|blob):/.test(r.url())) external.push(r.url()); });
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      const t = (id) => page.getByTestId(id);
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await page.goto(`${liveBase}/`);
      await t('uc-UC1').waitFor();
      check((await t('mode-live').getAttribute('title')).includes('two real calls'), `${tag}: Live is allowed (the title says what a live run does)`);
      await t('mode-live').click(); await page.waitForFunction(() => document.querySelector('[data-testid="mode"]').textContent.includes('Mode: live'));
      await page.waitForFunction(() => document.querySelector('[data-testid="banner"]').textContent.startsWith('LIVE mode'));
      check((await t('banner').getAttribute('data-state')) === 'live' && (await t('mode').innerText()).includes('identity provider only'), `${tag}: the banner and the chip say LIVE, identity provider only`);
      check((await t('mode-msg').innerText()).includes('two real calls'), `${tag}: selecting Live says what a run does`);
      await t('search').fill('UC7'); await page.locator('[data-testid="uc-UC7"]').click(); await t('search').fill('');
      check(await t('live-persona-note').isVisible() && (await t('persona').count()) === 0 && (await t('lab-inputs').count()) === 0, `${tag}: the persona and the lab inputs are hidden in live and the note says why`);
      await t('run').click(); await t('result').waitFor();
      check((await t('outcome').innerText()) === 'LIVE_OK' && (await t('live-note-tag').innerText()) === 'live, identity provider only' && (await t('matches').count()) === 0, `${tag}: UC7 live is LIVE_OK, labelled identity provider only, with no engine-match claim`);
      check((await t('hop').count()) === 2 && (await t('hops').getByTestId('live-tag').count()) === 2 && (await t('hops').getByTestId('mock-tag').count()) === 0, `${tag}: two hops, both LIVE, none MOCK`);
      check((await t('token-raw').innerText()) === `${FAKE_TOKEN.slice(0, 6)}...${FAKE_TOKEN.slice(-4)}` && (await t('token-claims').innerText()).includes(CLIENT_ID), `${tag}: the token is masked (first 6, last 4) and its claims are decoded`);
      const not = await t('not-run').innerText();
      check(not.includes('Not run in live mode') && not.includes('authorize-decision') && not.includes('identity provider only') && (await t('not-run').getByRole("listitem").count()) >= 1, `${tag}: the steps that were not run are listed`);
      check((await t('nav-page-approval').count()) === 0, `${tag}: a live run of UC7 opens no extra page`);
      await t('hops-toggle').click();
      const text = await page.locator('body').innerText();
      check(![CLIENT_SECRET, FAKE_TOKEN, FAKE_TOKEN.split('.')[2], Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')].some((x) => text.includes(x)), `${tag}: the page (all hops open) holds no secret and no raw token`);
      check(fake.seen.length === 2 && fake.seen[0].method === 'GET' && fake.seen[1].method === 'POST', `${tag}: the fake PingOne saw exactly two calls (GET discovery, POST token)`);
      check((await overflow()) <= 0, `${tag}: the live result does not scroll sideways (${await overflow()} px)`);
      if (tag === 'live-desktop-light' || tag === 'live-phone-dark') await page.screenshot({ path: path.join(shots, `${tag}.png`), fullPage: true });
      fake.state.behaviour = 'bad-secret';
      await t('run').click(); await page.waitForFunction(() => document.querySelector('[data-testid="outcome"]').textContent === 'LIVE_REFUSED');
      check((await t('hop').nth(1).getByTestId('hop-verdict').innerText()) === 'deny' && (await t('tokens').count()) === 0, `${tag}: a refused client secret shows a deny hop and no token`);
      await t('nav-runs').click(); await t('history').waitFor();
      check((await t('history-row').count()) === 2 && (await t('history-row').first().innerText()).includes('n/a (live)'), `${tag}: run history lists both live runs`);
      await t('nav-diagram').click(); await page.locator('.react-flow__node').first().waitFor();
      check((await overflow()) <= 0, `${tag}: the diagram page in live does not scroll sideways`);
      await t('mode-mock').click(); await page.waitForFunction(() => document.querySelector('[data-testid="mode"]').textContent.includes('Mode: mock'));
      await t('nav-agent').click(); await t('run').click(); await t('refusal').waitFor();
      check((await t('refusal').getAttribute('data-code')) === 'mock_signin_refused', `${tag}: under IDP=pingone a mock run is refused (rule 11)`);
      check(external.filter((u) => !u.startsWith(liveBase)).length === 0, `${tag}: the browser made no request to another origin (${external.length})`);
      check(errors.every((e) => /status of (403|409)/.test(e)), `${tag}: no unexpected console error (${errors.filter((e) => !/status of (403|409)/.test(e)).slice(0, 2).join(' | ')})`);
      await ctx.close();
    }
  }
} finally { if (browser) await browser.close(); server.kill(); liveServer.kill(); await fake.close(); fs.rmSync(settingsDir, { recursive: true, force: true }); }
console.log(`\n${checks - failures} of ${checks} checks passed`);
process.exit(failures ? 1 : 0);
