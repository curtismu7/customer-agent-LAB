import { installNetguard } from './netguard.js';
import { startHttpServer, createApp } from './app.js';
import { allPassed, runChecks } from './doctor.js';
import { assertBindAllowed, bindHost, liveRefusal, resolvePort } from './safety.js';
import { defaultMode, modeFrom } from './config.js';
import { applySharedSettings, readLiveSettings, settingsPath } from './settings.js';
import { createLive, hostToAllow, liveConfig } from './live.js';
import { createHealth } from './health.js';
import { createWorkspaces } from './workspaces.js';

const guard = installNetguard(); // before anything else can open a socket

// The one shared settings file (rulebook): ~/Development/.env, or STANDALONE_ENV. Optional; only this lab's own key is taken; never printed.
applySharedSettings();

const checks = await runChecks();
if (!allPassed(checks)) {
  for (const c of checks.filter((x) => x.level === 'fail')) console.error(`[customer-agent-lab] refusing to start: ${c.id}: ${c.detail}`);
  process.exit(1);
}
const mode = modeFrom(process.env); // refuses anything but mock or live
const host = assertBindAllowed(bindHost(), process.env);
// Live mode (step 3, owner opt-in): the worker client and environment come from the shared file and stay in live.js (never in process.env). The netguard
// then allows the one PingOne host; with no opt-in, no configuration or a loopback test base it allows nothing and the lab reaches no network.
const live = createLive({ config: liveConfig(readLiveSettings(settingsPath()), process.env) });
const liveRefused = liveRefusal({ env: process.env, bind: host, headers: {} });
const liveOn = live.configured() && liveRefused === null;
const liveHost = hostToAllow(live, liveRefused);
if (liveHost) guard.allowHost(liveHost);
const app = createApp({ bind: host, workspaces: createWorkspaces({ defaultMode: defaultMode() }), live, health: createHealth({ runtime: () => (liveOn ? 'live' : 'offline') }) });
const { url } = await startHttpServer({ port: resolvePort(), host, app });
console.log(`[customer-agent-lab] lab at ${url} (opens in ${mode} mode; loopback; ${liveOn ? `live is on: outbound only to ${live.origin()}` : 'no outbound network'})`);
console.log(`[customer-agent-lab] health: ${url}api/health`);
