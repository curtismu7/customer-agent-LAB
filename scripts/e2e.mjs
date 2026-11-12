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
import { AGENT_CLIENT_SECRET, CLIENT_ID, CLIENT_SECRET, DEMO_PASSWORD, DEMO_USERNAME, FAKE_TOKEN, USER_CLIENT_SECRET, fullSettingsFor, settingsFor, startFakePingOne } from '../server/test/fakePingone.js';
import { TRUSTED_HEADERS } from '../server/src/mcpClient.js';
import { REAL_KEYS } from '../server/src/settings.js';
import { startFakeGateway } from '../server/test/fakeGateway.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.E2E_SHOTS || path.join(root, '.data', 'e2e-screenshots');
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
let failures = 0; let checks = 0;
const check = (ok, what) => { checks += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failures += 1; };

const port = Number(process.env.E2E_PORT) || 5690;
if (port < 5603 || port > 5696) { console.error('E2E_PORT must be inside 5603-5696 (the live, hosted and full-Real instances take the next three ports)'); process.exit(2); }
const base = `http://127.0.0.1:${port}`;
if (!fs.existsSync(path.join(root, 'web', 'dist', 'index.html'))) { console.error('Run `npm run build` first.'); process.exit(2); }
// The Mock instance has no PingOne settings (an empty settings file, like a fresh clone or CI with no .env) and no IDP pin, so Real is disabled by
// the missing settings alone and its tooltip says what to fill in.
const noEnvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-e2e-none-'));
const noEnvFile = path.join(noEnvDir, '.env');
fs.writeFileSync(noEnvFile, '', { mode: 0o600 });
const env = { ...process.env, PORT: String(port), ALLOW_MOCK_SIGNIN: '1', CAL_ENV_FILE: noEnvFile };
for (const k of ['CALAB_BIND', 'CAL_ALLOW_LIVE', 'CAL_LAB_MODE', 'IDP', 'CAL_LIVE_FROM_ENV', 'CAL_LIVE_TEST_BASE', ...REAL_KEYS]) delete env[k];
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

// Live mode (step 3) is driven against a FAKE PingOne on loopback: a second lab instance with NO opt-in and no IDP pin (option a, owner 2026-11-10: the
// settings alone make Real available), a temp settings file (mode 600, fake values) and CAL_LIVE_TEST_BASE pointing at the fake. The toggle is switched
// Mock -> Real -> Mock -> Real in one page against the one running server: no restart. No real tenant is touched; the real PingOne path is UNVERIFIED and owner-run.
const livePort = port + 1;
const liveBase = `http://127.0.0.1:${livePort}`;
const fake = await startFakePingOne();
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-e2e-'));
const settingsFile = path.join(settingsDir, '.env');
fs.writeFileSync(settingsFile, `${Object.entries(settingsFor()).map(([k, v]) => `${k}=${v}`).join('\n')}\n`, { mode: 0o600 });
const liveEnv = { ...process.env, PORT: String(livePort), ALLOW_MOCK_SIGNIN: '1', CAL_ENV_FILE: settingsFile, CAL_LIVE_TEST_BASE: fake.base };
for (const k of ['CALAB_BIND', 'CAL_LAB_MODE', 'IDP', 'CAL_ALLOW_LIVE', 'CAL_LIVE_FROM_ENV']) delete liveEnv[k];
const liveServer = spawn(process.execPath, ['server/src/index.js'], { cwd: root, env: liveEnv, stdio: 'inherit' });
let liveUp = false;
for (let i = 0; i < 160 && !liveUp; i++) { try { liveUp = (await fetch(`${liveBase}/api/health`)).ok; } catch { await sleep(250); } }
if (!liveUp) { server.kill(); liveServer.kill(); console.error('live server did not start'); process.exit(2); }

// The hosted build (CAL_DEPLOY_MODE=hosted): a third instance, mock only. Its Real button is disabled with a note and never asks the server.
const hostedPort = port + 2;
const hostedBase = `http://127.0.0.1:${hostedPort}`;
const hostedEnv = { ...process.env, PORT: String(hostedPort), CAL_DEPLOY_MODE: 'hosted', CAL_LAB_MODE: 'mock', ALLOW_MOCK_SIGNIN: '1', IDP: 'mock' };
delete hostedEnv.CALAB_BIND; delete hostedEnv.CAL_ALLOW_LIVE; delete hostedEnv.CAL_BRAIN_URL;
const hostedServer = spawn(process.execPath, ['server/src/index.js'], { cwd: root, env: hostedEnv, stdio: 'inherit' });
let hostedUp = false;
for (let i = 0; i < 160 && !hostedUp; i++) { try { hostedUp = (await fetch(`${hostedBase}/api/health`)).ok; } catch { await sleep(250); } }
if (!hostedUp) { server.kill(); liveServer.kill(); hostedServer.kill(); console.error('hosted server did not start'); process.exit(2); }

// Full Real (owner, 2026-11-10): a fourth instance with the full-Real settings (fake values), the fake PingOne (pi.flow, flows API, code, client
// credentials, token exchange with act) and the fake Agent Gateway (MCP). Still no real tenant and no SE: both fakes are on loopback.
const fullPort = port + 3;
const fullBase = `http://127.0.0.1:${fullPort}`;
const fullP1 = await startFakePingOne();
const fullGw = await startFakeGateway({ isDelegated: (tok) => fullP1.issued.delegated.has(tok) });
const fullFile = path.join(settingsDir, 'full.env');
fs.writeFileSync(fullFile, `${Object.entries({ ...settingsFor(), ...fullSettingsFor(fullGw.url) }).map(([k, v]) => `${k}=${v}`).join('\n')}\n`, { mode: 0o600 });
const fullEnv = { ...process.env, PORT: String(fullPort), ALLOW_MOCK_SIGNIN: '1', CAL_ENV_FILE: fullFile, CAL_LIVE_TEST_BASE: fullP1.base };
for (const k of ['CALAB_BIND', 'CAL_LAB_MODE', 'IDP', 'CAL_ALLOW_LIVE', 'CAL_LIVE_FROM_ENV']) delete fullEnv[k];
const fullServer = spawn(process.execPath, ['server/src/index.js'], { cwd: root, env: fullEnv, stdio: 'inherit' });
let fullUp = false;
for (let i = 0; i < 160 && !fullUp; i++) { try { fullUp = (await fetch(`${fullBase}/api/health`)).ok; } catch { await sleep(250); } }
if (!fullUp) { server.kill(); liveServer.kill(); hostedServer.kill(); fullServer.kill(); console.error('full-Real server did not start'); process.exit(2); }

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
      check((await page.locator('a[href]:not(.shelf-link, .top-menu a[href])').count()) === 0 && (await page.locator('a.shelf-link').count()) <= 1 && (await page.locator('.shell-bar a.shelf-link').count()) === (await page.locator('a.shelf-link').count()), `${tag}: no link anywhere but the header Shelf button (link-outs are plain labels)`);
      await t('nav-more').selectOption('page-approval'); await t('extra-approval').waitFor();
      check((await overflow()) <= 0, `${tag}: the extra page does not scroll sideways (${await overflow()} px)`);
      await t('nav-agent').click();
      await t('vertical').selectOption('government'); await pick('UC1'); await t('run').click(); await t('refusal').waitFor();
      check((await t('refusal').getAttribute('data-code')) === 'vertical_stub' && (await t('refusal').innerText()).includes('Not built'), `${tag}: a stub vertical shows the honest not built state (HTTP 501)`);
      await t('vertical').selectOption('banking');
      // The shared TopMenu names the Real option mode-real; with no .env the option is disabled and its title says what to fill in.
      const realOpt = page.getByTestId('mode-real');
      await page.waitForFunction(() => document.querySelector('[data-testid="mode-real"]')?.disabled === true);
      check(/^Real is not configured: fill PINGONE_ENVIRONMENT_ID, CAL_USER_CLIENT_ID, CAL_USER_CLIENT_SECRET, CAL_AGENT_CLIENT_ID, CAL_AGENT_CLIENT_SECRET, CAL_DEMO_USERNAME, CAL_AGENT_GATEWAY_URL, CAL_GATEWAY_AUDIENCE, CAL_GATEWAY_SCOPE in this app's \.env/.test(await realOpt.getAttribute('title')) && (await t('mode').innerText()).includes('mock'), `${tag}: with no .env Real is disabled, its tooltip says what to fill in, and the page stays Mock`);
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
      await page.locator('.react-flow__node').first().scrollIntoViewIfNeeded(); // the drag needs the box inside the viewport, whatever sits above it
      const box = await page.locator('.react-flow__node').first().boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 5 }); await page.mouse.up();
      check((await t('diagram-moved').innerText()).includes('Moved: 1 box'), `${tag}: a box can be moved`);
      await t('diagram-reset').click(); await sleep(200);
      check((await t('diagram-moved').innerText()).includes('Moved: 0 box'), `${tag}: Reset restores the box positions`);

      await t('theme-select').selectOption('dark');
      check((await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark', `${tag}: the theme picker sets data-theme=dark`);
      await t('theme-select').selectOption('auto');
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
      await t('theme-select').selectOption(scheme);
      check(await oneRow(), `${tag}: the shell bar is one row`);
      const wtt = await t('what-to-type').innerText();
      check((await t('wtt-heading').innerText()).toUpperCase() === 'WHAT TO TYPE · BANKING · FABRIKAM BANK' && wtt.includes('show my balance'), `${tag}: What to type names the vertical and lists its prompts`);
      check((await t('wtt-away').getByRole('button').count()) >= 1 && wtt.toLowerCase().includes('opens its own app'), `${tag}: What to type has an Opens its own app group`);

      await t('wtt-UC1').click(); await t('turn-answer').waitFor(); await sleep(300);
      // a chat turn is the message and one reply (owner 2026-11-09): no reasoning, token cards or hop pills; those stay in the evidence column
      const lastTurn = () => page.getByTestId('turn').last();
      const onlyReply = async () => { const tx = await lastTurn().innerText(); return (await lastTurn().getByRole('button', { name: /^Hop \d/ }).count()) === 0 && !/Reasoning|Tokens used|Step 1|routing table/i.test(tx); };
      check(await onlyReply() && (await lastTurn().getByTestId('turn-who').innerText()).toUpperCase() === 'AGENT' && (await lastTurn().getByTestId('turn-answer-text').innerText()) === 'Your checking balance is $4,250.00, and your savings balance is $12,800.00.', `${tag}: UC1 is the message and the agent's answer only, a real sentence with lab-invented amounts`);
      // go deeper and the use case panel are in the evidence column, not the chat (owner 2026-11-09)
      check((await lastTurn().getByTestId('go-deeper').count()) === 0 && (await t('agent-column').getByTestId('uc-panel').count()) === 0 && (await t('evidence-column').getByTestId('go-deeper').innerText()).toLowerCase().includes('go deeper in') && (await t('evidence-column').getByTestId('uc-panel').count()) === 1, `${tag}: go deeper and the use case panel sit in the evidence column, not the reply`);
      check((await t('evidence-why').innerText()).includes('Matched your words to UC1') && (await t('evidence-count').innerText()).startsWith('UC1 ·'), `${tag}: the reasoning and the hops are in the evidence column`);
      await t('wtt-UC6').click(); await page.getByTestId('turn').nth(1).getByTestId('turn-answer').waitFor();
      check(await onlyReply() && (await lastTurn().getByTestId('turn-who').innerText()).toUpperCase() === 'AUTHORIZE' && (await lastTurn().getByTestId('turn-answer-text').innerText()).startsWith('Authorize refused this request (HTTP 403): amount 2500'), `${tag}: UC6 is Authorize's refusal in plain words`);
      await t('wtt-UC1').click(); await page.getByTestId('turn').nth(2).getByTestId('turn-answer').waitFor(); await sleep(300);
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
      check(await onlyReply() && (await lastTurn().getByTestId('turn-who').innerText()).toUpperCase() === 'AUTHORIZE', `${tag}: the step-up hold is labelled Authorize and carries no reasoning or pills`);
      check((await lastTurn().getByTestId('turn-approval-say').innerText()) === "I'm ready to move $600 from checking to savings.", `${tag}: the held $600 transfer says what the agent is ready to do, with the amount`);
      check(!/mock result of|Here is what I found/.test(await t('agent-column').innerText()), `${tag}: nothing in the chat says mock result of`);
      check(await oneRow(), `${tag}: the shell bar is still one row after a second extra page`);
      check((await page.evaluate(() => [...document.querySelectorAll('[data-testid="nav-more"] option')].length)) === 3, `${tag}: both extra pages are in the More menu`);
      if (scheme === 'light') await page.screenshot({ path: path.join(shots, `agent-${width}.png`) });

      // a hand-off chip: the reply is one line and the card's buttons in the conversation, in view; why it hands off is in the evidence column
      const visibleCard = () => page.evaluate(() => {
        const cards = document.querySelectorAll('[data-testid="turn"] [data-testid="handoff-card"]'); const c = cards[cards.length - 1];
        if (!c) return { ok: false };
        const r = c.getBoundingClientRect(); const box = c.closest('.agentcol__scroll').getBoundingClientRect();
        return { ok: r.top >= box.top - 1 && r.bottom <= box.bottom + 1 && r.bottom <= window.innerHeight, top: Math.round(r.top), bottom: Math.round(r.bottom), box: [Math.round(box.top), Math.round(box.bottom)] };
      });
      await t('wtt-away').getByRole('button').first().click(); await sleep(300);
      let v = await visibleCard();
      check(v.ok, `${tag}: a hand-off chip shows the hand-off card in the conversation, in view without scrolling (${v.top}-${v.bottom} in ${v.box})`);
      check(await onlyReply() && (await lastTurn().getByTestId('turn-handoff-say').innerText()).startsWith('This is handled in ') && (await t('handoff-why').innerText()).includes('runs in its own app'), `${tag}: the hand-off reply is one line; its reasoning is in the evidence column`);
      check((await t('agent-status').innerText()) === 'Ready to hand off', `${tag}: the agent status reads Ready to hand off`);
      await t('search').fill('UC2.6'); await t('uc-UC2.6').click(); await t('search').fill(''); await sleep(300);
      v = await visibleCard();
      check(v.ok && (await page.getByTestId('turn').last().getByTestId('turn-said').innerText()).startsWith('UC2.6'), `${tag}: a hand-off picked in the sidebar answers in the conversation with the card in view`);
      if (scheme === 'light') await page.screenshot({ path: path.join(shots, `agent-${width}-handoff.png`) });
      check((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, `${tag}: the agent page does not scroll sideways`);

      // resume: the tab leaves for the other app and comes Back with ?returned=: the chat is restored (words and outcomes, no run), a note says so, the query is gone
      const turnsBefore = await page.getByTestId('turn').count();
      await page.goto(`${base}/?returned=a2a-lab&uc=UC2.6`); await t('turn-note').waitFor();
      check((await page.getByTestId('turn').count()) === turnsBefore && (await t('turn-note').innerText()) === 'Back from a2a-lab (UC2.6)' && (await page.evaluate(() => window.location.search)) === '', `${tag}: Back from a2a-lab restores ${turnsBefore} turns, adds the note and cleans the address bar`);
      check((await t('turn-restored').first().innerText()).includes('run it again') && (await page.getByTestId('turn-tokens').count()) === 0 && !(await page.evaluate(() => Object.values(sessionStorage).join(''))).includes('eyJ'), `${tag}: restored runs say run it again; no token on the page or in sessionStorage`);

      await t('full-sequence').click(); await t('page-sequence').waitFor();
      if (!(await t('sequence-view').count())) { await page.getByTestId('uc-UC1').click(); await t('sequence-view').waitFor(); }
      f = await fit();
      check(f.zoom === 'fit' && f.sw <= f.cw && f.inside, `${tag}: the full-page sequence fits at the default zoom (${f.sw} of ${f.cw} px)`);
      check(errors.length === 0, `${tag}: no unexpected console error (${errors.slice(0, 2).join(' | ')})`);
      await ctx.close();
    }
  }

  // ---- The Agent to agent page (owner, 2026-11-09: keep #page-a2a): UC2's chip runs here, opens the page, and offers going deeper in a2a-lab ----
  {
    const tag = 'a2a-page';
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/status of (403|409|501)/.test(m.text())) errors.push(m.text()); });
    const t = (id) => page.getByTestId(id);
    await page.goto(`${base}/`); await t('wtt-UC1').waitFor();
    check((await t('nav-page-a2a').count()) === 0, `${tag}: no Agent to agent page before a run`);
    await t('composer-input').fill('hand off to a specialist'); await t('composer-send').click();
    const turn = page.getByTestId('turn').last();
    await turn.getByTestId('turn-answer').waitFor();
    check((await turn.getAttribute('data-status')) === 'done' && (await turn.getByTestId('handoff-card').count()) === 0, `${tag}: "hand off to a specialist" runs UC2 here (no hand-off card)`);
    check((await turn.getByTestId('go-deeper').count()) === 0 && (await t('evidence-column').getByTestId('go-deeper').textContent()).includes('Go deeper in a2a-lab'), `${tag}: the evidence column (not the reply) offers going deeper in a2a-lab`);
    check((await turn.getByTestId('turn-answer-text').innerText()).startsWith('Your portfolio is worth $86,300.00'), `${tag}: UC2's reply is the portfolio summary`);
    check((await t('nav-page-a2a').innerText()) === 'Agent to agent', `${tag}: the Agent to agent page is in the More menu`);
    await t('nav-more').selectOption('page-a2a');
    const a2a = t('extra-a2a');
    await a2a.waitFor();
    const text = async () => a2a.textContent(); // textContent: the hop kinds sit inside closed <details>, and headings are styled
    const kinds = ['a2a-exchange-1', 'a2a-exchange-2', 'a2a-agent-card', 'a2a-protocol-message'];
    const pageOk = async () => { const x = await text(); return x.includes('Agent to agent') && x.includes('Opened by UC2: A2A delegation') && x.includes('agent-card, delegation and trust hops') && x.includes('PERMIT') && x.includes('Hops for this page (4)') && kinds.every((k) => x.includes(`(${k})`)) && !x.includes('(gateway-check)') && !x.includes('(tool-dispatched)'); };
    check((await page.evaluate(() => window.location.hash)) === '#page-a2a' && (await pageOk()), `${tag}: the page shows its label, what it is, the outcome and only UC2's four delegation hops`);
    // the More menu shows the selected page's whole label (it was cut to "Agent to a"), and the shell bar still fits at 1280 and 375 px
    const moreLabel = () => page.evaluate(() => {
      const sel = document.querySelector('[data-testid="nav-more"]'); const cs = getComputedStyle(sel);
      const c = document.createElement('canvas').getContext('2d'); c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const need = c.measureText(sel.selectedOptions[0].textContent).width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 16; // + the arrow
      const bar = document.querySelector('.shell-bar').getBoundingClientRect();
      return { label: sel.selectedOptions[0].textContent, need: Math.ceil(need), have: Math.floor(sel.getBoundingClientRect().width), inBar: sel.getBoundingClientRect().right <= bar.right + 1, noSideScroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth };
    });
    for (const w of [1280, 375]) {
      await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(150);
      const m = await moreLabel();
      check(m.label === 'Agent to agent' && m.have >= m.need && m.inBar && m.noSideScroll, `${tag}: at ${w} px the More menu shows "${m.label}" whole (${m.have} px for ${m.need}) inside the shell bar, no sideways scroll`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await t('nav-agent').click(); await t('agent-column').waitFor();
    await page.goto(`${base}/#page-a2a`); await a2a.waitFor();
    check(await pageOk(), `${tag}: opening ${base}/#page-a2a after the run shows the page`);
    await page.screenshot({ path: path.join(shots, 'a2a-page.png') });
    check(errors.length === 0, `${tag}: no unexpected console error (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
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
      // Live is allowed here (the .env is set): the Real option is enabled; what a live run does is said by the banner and the mode chip.
      await page.waitForFunction(() => document.querySelector('[data-testid="mode-real"]')?.disabled === false);
      await t('mode-select').selectOption('real'); await page.waitForFunction(() => document.querySelector('[data-testid="mode"]').textContent.includes('Mode: live'));
      await page.waitForFunction(() => document.querySelector('[data-testid="banner"]').textContent.startsWith('REAL mode'));
      check((await t('banner').getAttribute('data-state')) === 'live' && (await t('mode').innerText()).includes('identity provider only'), `${tag}: the banner and the chip say LIVE, identity provider only`);
      check((await t('mode-msg').innerText()).includes('two real calls'), `${tag}: selecting Live says what a run does`);
      await t('search').fill('UC7'); await page.locator('[data-testid="uc-UC7"]').click(); await t('search').fill('');
      check(await t('live-persona-note').isVisible() && (await t('persona').count()) === 0 && (await t('lab-inputs').count()) === 0, `${tag}: the persona and the lab inputs are hidden in live and the note says why`);
      await t('run').click(); await t('result').waitFor();
      check((await t('outcome').innerText()) === 'LIVE_OK' && (await t('live-note-tag').innerText()) === 'live, identity provider only' && (await t('matches').count()) === 0, `${tag}: UC7 live is LIVE_OK, labelled identity provider only, with no engine-match claim`);
      check((await t('hop').count()) === 2 && (await t('hops').getByTestId('real-tag').count()) === 2 && (await t('hops').getByTestId('mock-tag').count()) === 0 && (await t('hops').innerText()).includes('identity provider only [REAL]'), `${tag}: two hops, both REAL (identity provider only), none MOCK`);
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
      await t('mode-select').selectOption('mock'); await page.waitForFunction(() => document.querySelector('[data-testid="mode"]').textContent.includes('Mode: mock'));
      const seenBefore = fake.seen.length;
      await t('nav-agent').click(); await t('run').click();
      await page.waitForFunction(() => { const o = document.querySelector('[data-testid="outcome"]'); return o && !o.textContent.startsWith('LIVE_'); });
      check((await t('banner').getAttribute('data-state')) === 'mock' && (await t('refusal').count()) === 0 && fake.seen.length === seenBefore, `${tag}: back in Mock without a restart, a mock run signs in with the mock persona and runs (outcome ${await t('outcome').innerText()}), no call to the fake`);
      await t('mode-select').selectOption('real'); await page.waitForFunction(() => document.querySelector('[data-testid="mode"]').textContent.includes('Mode: live'));
      check((await t('banner').getAttribute('data-state')) === 'live', `${tag}: and Real again, same server, no restart`);
      await t('mode-select').selectOption('mock'); await page.waitForFunction(() => document.querySelector('[data-testid="mode"]').textContent.includes('Mode: mock'));
      check(external.filter((u) => !u.startsWith(liveBase)).length === 0, `${tag}: the browser made no request to another origin (${external.length})`);
      check(errors.every((e) => /status of (403|409)/.test(e)), `${tag}: no unexpected console error (${errors.filter((e) => !/status of (403|409)/.test(e)).slice(0, 2).join(' | ')})`);
      await ctx.close();
    }
  }

  // ---- Full Real against the fakes: sign in through the modal (pi.flow), run a Real use case, see REAL hops and the reply, a DENY, then Mock ----
  for (const [width, height, name, scheme] of [[1280, 900, 'desktop', 'light'], [375, 800, 'phone', 'dark']]) {
    const tag = `full-${name}-${scheme}`;
    fullGw.seen.length = 0; fullP1.seen.length = 0; fullGw.state.behaviour = 'ok';
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
    const page = await ctx.newPage();
    const external = []; const errors = []; const navs = [];
    page.on('request', (r) => { if (!r.url().startsWith(fullBase) && !/^(data|blob):/.test(r.url())) external.push(r.url()); });
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs.push(f.url()); });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const t = (id) => page.getByTestId(id);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.goto(`${fullBase}/`);
    await t('uc-UC1').waitFor();
    // Real is available (the fake PingOne is configured): the Real option is enabled; what a full Real run does is said by the banner and the mode chip.
    await page.waitForFunction(() => document.querySelector('[data-testid="mode-real"]')?.disabled === false);
    await t('mode-select').selectOption('real'); await page.waitForFunction(() => document.querySelector('[data-testid="mode"]').textContent.includes('real: sign-in, token exchange, Agent Gateway'));
    check(await t('sign-in').isVisible(), `${tag}: Real shows the Sign in button`);
    await t('search').fill('UC1'); await page.locator('[data-testid="uc-UC1"]').click(); await t('search').fill('');
    await t('run').click();
    await t('signin-dialog').waitFor();
    check((await t('signin-username').inputValue()) === DEMO_USERNAME && (await t('signin-username').getAttribute('readonly')) !== null, `${tag}: a Real run before sign-in opens the Sign in modal with the username filled in, read-only`);
    check((await t('signin-password').getAttribute('type')) === 'password' && (await t('signin-dialog').getAttribute('role')) === 'dialog', `${tag}: the modal is a dialog with a password field`);
    if (tag === 'full-desktop-light' || tag === 'full-phone-dark') await page.screenshot({ path: path.join(shots, `${tag}-signin.png`), fullPage: false });
    await t('signin-password').fill(DEMO_PASSWORD);
    await t('signin-submit').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="outcome"]')?.textContent === 'REAL_PERMIT', null, { timeout: 20000 });
    check((await t('signin-dialog').count()) === 0 && (await t('who').innerText()).includes(DEMO_USERNAME), `${tag}: signed in, the modal closed and the header names the user`);
    const authz = fullP1.seen.filter((x) => x.url.includes('/as/authorize'));
    check(authz.length >= 1 && authz.every((x) => new URL(x.url, 'http://x').searchParams.get('response_mode') === 'pi.flow' && new URL(x.url, 'http://x').searchParams.get('code_challenge_method') === 'S256'), `${tag}: the sign-in was pi.flow with PKCE S256`);
    check(navs.length === 1 && navs[0].startsWith(fullBase), `${tag}: the page never navigated (no redirect login): ${navs.join(' | ')}`);
    const srcs = await t('hop-source').evaluateAll((els) => els.map((e) => e.getAttribute('data-source')));
    check(srcs.length === 9 && srcs.every((x) => x === 'real'), `${tag}: Where each hop ran lists nine hops (two token exchanges), every one REAL (${srcs.join(',')})`);
    check((await t('hops').getByTestId('real-tag').count()) === 9 && (await t('hops').getByTestId('mock-tag').count()) === 0, `${tag}: the hop list tags all nine REAL, none MOCK`);
    const titles = await t('hop-source').evaluateAll((els) => els.map((e) => e.textContent));
    check(titles[2].includes('Exchange 1: act = agent') && titles[3].includes('Exchange 2: for the gateway'), `${tag}: the two exchanges are named in Where each hop ran (${titles.slice(2, 4).join(' | ')})`);
    const tx = fullP1.seen.filter((x) => x.method === 'POST' && x.url.endsWith('/as/token')).map((x) => Object.fromEntries(new URLSearchParams(x.body))).filter((f) => f.grant_type === 'urn:ietf:params:oauth:grant-type:token-exchange');
    check(tx.length === 2 && tx[0].actor_token && !tx[1].actor_token && tx.every((f) => f.audience === undefined) && tx[0].scope === 'agent:invoke' && tx[1].scope === 'fake:mcp:invoke', `${tag}: PingOne saw exchange 1 (user + agent actor, agent:invoke) and exchange 2 (no actor, no audience, the gateway scope)`);
    check(fullGw.seen.every((c) => fullP1.issued.delegated.has(c.headers.authorization.slice(7))), `${tag}: every gateway call carried the exchange-2 token, which has act`);
    check((await t('token').count()) === 4 && (await t('token-act').count()) === 2 && (await t('token-no-act').count()) === 0, `${tag}: the Tokens tab lists the user, agent, exchange-1 and delegated tokens; both exchange tokens show their act`);
    check((await t('turn-answer-text').last().innerText()).includes('balance 1200.5') && (await t('turn-who').last().textContent()) === 'Agent', `${tag}: the reply is the real tool result, in the Agent's voice`);
    check(fullGw.seen.map((c) => c.rpc.method).join(',') === 'initialize,notifications/initialized,tools/list,tools/call,tools/call', `${tag}: the gateway saw initialize, tools/list and tools/call`);
    check(fullGw.seen.every((c) => TRUSTED_HEADERS.every((h) => c.headers[h] === undefined) && c.headers['x-token-validation'] === 'jwks'), `${tag}: no trusted-caller header reached the gateway`);
    await t('hops-toggle').click();
    const body = await page.locator('body').innerText();
    check(![DEMO_PASSWORD, USER_CLIENT_SECRET, AGENT_CLIENT_SECRET, CLIENT_SECRET].some((x) => body.includes(x)) && !(await page.content()).includes(DEMO_PASSWORD), `${tag}: the page holds no password and no client secret`);
    check((await overflow()) <= 0, `${tag}: the Real result does not scroll sideways (${await overflow()} px)`);
    await page.screenshot({ path: path.join(shots, `${tag}.png`), fullPage: true });
    // The gateway scope's resource stops passing act through: the lab stops BEFORE the gateway and says so.
    const gwBefore = fullGw.seen.length; fullP1.state.resources.gateway.act = 'absent';
    await t('run').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="outcome"]')?.textContent === 'REAL_NO_ACT', null, { timeout: 20000 });
    check(fullGw.seen.length === gwBefore, `${tag}: a delegated token with no act never reached the gateway`);
    check((await t('turn-answer-text').last().innerText()).includes("the delegated token carries no act claim: check the agent:invoke resource's act attribute") && (await t('token-no-act').count()) === 1, `${tag}: the reply says the delegated token carries no act claim and the token is flagged`);
    fullP1.state.resources.gateway.act = 'passthrough';
    fullGw.state.behaviour = 'deny';
    await t('run').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="outcome"]')?.textContent === 'REAL_DENY', null, { timeout: 20000 });
    check((await t('turn-who').last().textContent()) === 'Authorize' && (await t('turn-answer-text').last().innerText()).startsWith('Authorize denied this request (HTTP 403'), `${tag}: a 403 from the gateway is the Authorize DENY reply`);
    fullGw.state.behaviour = 'down';
    await t('run').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="outcome"]')?.textContent === 'REAL_UNREACHABLE', null, { timeout: 20000 });
    check((await t('turn-answer-text').last().innerText()).includes('SE is down or scaled down'), `${tag}: a 503 says SE is down or scaled down; switch to Mock`);
    const seen = fullGw.seen.length;
    await t('mode-select').selectOption('mock'); await page.waitForFunction(() => document.querySelector('[data-testid="mode"]').textContent.includes('Mode: mock'));
    await t('run').click();
    await page.waitForFunction(() => { const o = document.querySelector('[data-testid="outcome"]'); return o && !o.textContent.startsWith('REAL_'); });
    const msrc = await t('hop-source').evaluateAll((els) => els.map((e) => e.getAttribute('data-source')));
    check(fullGw.seen.length === seen && msrc.length > 0 && msrc.every((x) => x === 'mock' || x === 'not-run'), `${tag}: back in Mock without a restart: no gateway call and every hop MOCK`);
    check(external.length === 0, `${tag}: the browser made no request to another origin (${external.length})`);
    check(errors.every((e) => /status of (401|403|409)/.test(e)), `${tag}: no unexpected console error (${errors.filter((e) => !/status of (401|403|409)/.test(e)).slice(0, 2).join(' | ')})`);
    await ctx.close();
  }

  // ---- The hosted build: Real is disabled with a note (a click or Enter makes no /api/mode request, no error, the page stays Mock) ----------
  for (const [width, height, name] of [[1280, 900, 'desktop'], [375, 800, 'phone']]) {
    for (const scheme of ['light', 'dark']) {
      const tag = `hosted-${name}-${scheme}`;
      const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
      const page = await ctx.newPage();
      const external = []; const errors = []; let watch = false; const modeCalls = [];
      page.on('request', (r) => {
        if (!r.url().startsWith(hostedBase) && !/^(data|blob):/.test(r.url())) external.push(r.url());
        if (watch && new URL(r.url()).pathname === '/api/mode') modeCalls.push(`${r.method()} ${r.url()}`);
      });
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      const t = (id) => page.getByTestId(id);
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await page.goto(`${hostedBase}/`);
      await t('uc-UC1').waitFor();
      // The hosted copy uses the shared TopMenu: the Real option is a disabled <option> in the mode-select dropdown.
      const real = page.getByTestId('mode-real');
      await page.waitForFunction(() => document.querySelector('[data-testid="mode-real"]')?.disabled === true);
      await t('mode').filter({ hasText: 'Mode: mock' }).waitFor({ state: 'attached' });
      check((await real.evaluate((o) => o.disabled)) === true, `${tag}: Real is disabled`);
      check(await t('real-hosted-note').isVisible() && (await t('real-hosted-note').innerText()) === 'Mock only on the hosted copy. Run the lab locally for Real.', `${tag}: the note beside Real is shown`);
      watch = true;
      // A disabled <option> cannot be clicked or take focus; selecting it does nothing.
      await t('mode-select').selectOption('real').catch(() => {});
      check((await t('mode-select').inputValue()) === 'mock', `${tag}: selecting Real is refused and the select stays on mock`);
      check(modeCalls.length === 0, `${tag}: a click and Enter on Real made no /api/mode request (${modeCalls.join(' | ')})`);
      check((await t('mode-msg').count()) === 0 && (await t('mode').innerText()).includes('Mode: mock'), `${tag}: no error shown and the page stays Mock`);
      check((await overflow()) <= 0, `${tag}: the shell bar with the note fits the ${width}px viewport`);
      if (tag === 'hosted-phone-dark' || tag === 'hosted-desktop-light') await page.screenshot({ path: path.join(shots, `${tag}.png`), fullPage: false });
      check(external.length === 0, `${tag}: the browser made no request to another origin (${external.length})`);
      check(errors.length === 0, `${tag}: no console error (${errors.slice(0, 2).join(' | ')})`);
      await ctx.close();
    }
  }
} finally { if (browser) await browser.close(); server.kill(); liveServer.kill(); hostedServer.kill(); fullServer.kill(); await fake.close(); await fullP1.close(); await fullGw.close(); fs.rmSync(settingsDir, { recursive: true, force: true }); fs.rmSync(noEnvDir, { recursive: true, force: true }); }
console.log(`\n${checks - failures} of ${checks} checks passed`);
process.exit(failures ? 1 : 0);
