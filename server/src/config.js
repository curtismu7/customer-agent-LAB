// Deployment configuration. CAL_LAB_MODE is the DEFAULT mode a new workspace opens in (mock or live). Mock is the default. Anything else is an error,
// never a silent fallback. The one shared settings file (~/Development/.env, or STANDALONE_ENV) may carry CAL_LAB_MODE. A bare MODE is NOT read:
// the shared file is read by every standalone app, and another app's MODE must not switch this one.
// CAL_DEPLOY_MODE says where the lab runs: local (the default: a clone or local Docker) or hosted (the mock-only SE k8s build of the same image,
// rulebook section 6). Hosted is mock only: live, the llama.cpp brain and the shared settings file are refused or ignored. It is set in the pod
// manifest, never read from the shared settings file.
export const MODES = ['mock', 'live'];
export const DEPLOY_MODES = ['local', 'hosted'];
export function deployModeFrom(env = process.env) {
  const raw = env.CAL_DEPLOY_MODE;
  const m = raw === undefined || raw === '' ? 'local' : raw;
  if (!DEPLOY_MODES.includes(m)) throw new Error(`CAL_DEPLOY_MODE=${String(m).slice(0, 20)} is not available: use local or hosted`);
  return m;
}
export const isHosted = (env = process.env) => env.CAL_DEPLOY_MODE === 'hosted';
// The hosted build's Real button opens a dialog that sends the visitor to Meta Muse with this MCP connector URL (Agent Connect, then Agent Gateway,
// which asks PingOne Authorize before the MCP server is called). The one place the URL lives: CAL_MUSE_CONNECTOR_URL, with this default, hosted only.
// It must be https and must not point at loopback. A local build has none (null): its Real button keeps the local live path.
export const DEFAULT_MUSE_CONNECTOR_URL = 'https://agent-connect.ai-demo.ping-devops.com/mcp';
export function museConnectorUrlFrom(env = process.env) {
  if (!isHosted(env)) return null;
  const raw = env.CAL_MUSE_CONNECTOR_URL;
  const v = raw === undefined || raw === '' ? DEFAULT_MUSE_CONNECTOR_URL : raw;
  let u;
  try { u = new URL(v); } catch { throw new Error('CAL_MUSE_CONNECTOR_URL is not a URL'); }
  if (u.protocol !== 'https:') throw new Error('CAL_MUSE_CONNECTOR_URL must be https');
  if (u.username || u.password) throw new Error('CAL_MUSE_CONNECTOR_URL must not carry credentials');
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '::' || h === '0.0.0.0' || /^127\./.test(h) || /^::ffff:127\./.test(h)) {
    throw new Error('CAL_MUSE_CONNECTOR_URL must not point at loopback');
  }
  return u.href;
}
export function modeFrom(env = process.env) {
  const raw = env.CAL_LAB_MODE;
  const m = raw === undefined || raw === '' ? 'mock' : raw;
  if (!MODES.includes(m)) throw new Error(`CAL_LAB_MODE=${String(m).slice(0, 20)} is not available: use mock or live`);
  if (m !== 'mock' && deployModeFrom(env) === 'hosted') throw new Error('the hosted build is mock only: CAL_LAB_MODE must be mock');
  return m;
}
export const defaultMode = () => modeFrom(process.env);
export const modeOf = (v) => (typeof v === 'string' && MODES.includes(v) ? v : null);
