// Deployment configuration. CAL_LAB_MODE is the DEFAULT mode a new workspace opens in (mock or live). Mock is the default. Anything else is an error,
// never a silent fallback. The one shared settings file (~/Development/.env, or STANDALONE_ENV) may carry CAL_LAB_MODE. A bare MODE is NOT read:
// the shared file is read by every standalone app, and another app's MODE must not switch this one.
export const MODES = ['mock', 'live'];
export function modeFrom(env = process.env) {
  const raw = env.CAL_LAB_MODE;
  const m = raw === undefined || raw === '' ? 'mock' : raw;
  if (!MODES.includes(m)) throw new Error(`CAL_LAB_MODE=${String(m).slice(0, 20)} is not available: use mock or live`);
  return m;
}
export const defaultMode = () => modeFrom(process.env);
export const modeOf = (v) => (typeof v === 'string' && MODES.includes(v) ? v : null);
