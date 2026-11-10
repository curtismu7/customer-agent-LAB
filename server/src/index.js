import { installNetguard } from './netguard.js';
import { startHttpServer, createApp } from './app.js';
import { allPassed, runChecks } from './doctor.js';
import { assertBindAllowed, bindHost, liveRefusal, resolvePort } from './safety.js';
import { defaultMode, deployModeFrom, modeFrom } from './config.js';
import { applySharedSettings, liveSettingsFor, missingIn, takeLiveSettingsFromEnv } from './settings.js';
import { createLive, hostToAllow, liveConfig } from './live.js';
import { createHealth } from './health.js';
import { createWorkspaces } from './workspaces.js';
import { allowBrainHost, brainConfig, createBrain } from './brain.js';

const guard = installNetguard(); // before anything else can open a socket

// The hosted build (CAL_DEPLOY_MODE=hosted, the mock-only SE k8s pod) reads no settings file and no live settings: it is mock only.
const hosted = deployModeFrom(process.env) === 'hosted'; // refuses anything but local or hosted
// Docker: compose passes the four PINGONE_* names (CAL_LIVE_FROM_ENV=1). They leave process.env here, before the doctor or anything else runs.
// Hosted takes nothing: it is mock only.
if (!hosted) takeLiveSettingsFromEnv(process.env);
// The app's own .env beside docker-compose.yml (settings.js; CAL_ENV_FILE for tests). Optional; only this lab's own key is taken; never printed.
if (!hosted) applySharedSettings();

const checks = await runChecks();
if (!allPassed(checks)) {
  for (const c of checks.filter((x) => x.level === 'fail')) console.error(`[customer-agent-lab] refusing to start: ${c.id}: ${c.detail}`);
  process.exit(1);
}
const mode = modeFrom(process.env); // refuses anything but mock or live
const host = assertBindAllowed(bindHost(), process.env);
// Real (step 3): the worker client and environment come from the app's .env (host run) or from compose substitution of it (Docker), and stay in live.js
// (never in process.env). When they are complete and no guard refuses, the netguard allows the one PingOne host; with CAL_ALLOW_LIVE=0, no configuration,
// a refusing guard or a loopback test base it allows nothing and the lab reaches no network.
const liveSettings = hosted ? {} : liveSettingsFor(process.env);
const live = hosted ? createLive() : createLive({ config: liveConfig(liveSettings, process.env), missing: missingIn(liveSettings) });
const liveRefused = liveRefusal({ env: process.env, bind: host, headers: {} });
const liveOn = live.configured() && liveRefused === null;
const liveHost = hostToAllow(live, liveRefused);
if (liveHost) guard.allowHost(liveHost);
// The llama.cpp brain (Step 2, owner opt-in): one origin from CAL_BRAIN_URL, loopback or host.docker.internal only. Loopback is already allowed; from Docker the
// netguard allows host.docker.internal and nothing else. Unset or invalid: no brain, and the page offers Scripted only.
const brainCfg = brainConfig(process.env);
allowBrainHost(guard, brainCfg);
const brain = createBrain({ config: brainCfg });
const app = createApp({ bind: host, workspaces: createWorkspaces({ defaultMode: defaultMode() }), live, brain, health: createHealth({ runtime: () => (liveOn ? 'live' : 'offline') }) });
const { url } = await startHttpServer({ port: resolvePort(), host, app });
console.log(`[customer-agent-lab] lab at ${url} (opens in ${mode} mode; ${hosted ? 'hosted build, mock only' : 'loopback'}; ${liveOn ? `live is on: outbound only to ${live.origin()}` : 'no outbound network'}${brain.configured() ? `; brain: ${brain.label()}` : ''})`);
console.log(`[customer-agent-lab] health: ${url}api/health`);
