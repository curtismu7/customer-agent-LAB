// {{token}} templating for the story, hop labels and narration. Tokens are filled from one of three FULL vertical packs (banking, healthcare, retail).
// The other verticals are listed as data stubs: they have a name and nothing else, and a run on one is refused with 501. A test fails on any token a pack does not define.
// Every person, agent and host in a pack is synthetic: only .example hosts, no real company, tenant or account.
import fs from 'node:fs';
import { scanHosts } from './safety.js';

const TOKEN = /\{\{(\w+)\}\}/g;
const MAX_CAST = 40;
const ID = /^[a-z0-9.-]{1,40}$/;

// The tool names per ROLE. The manifest's primaryTool is a banking tool name; a run in another vertical swaps in that vertical's tool for the same role
// (lab reading of the source's per-vertical tool maps: the names are the source's, the role grouping is the lab's).
export const TOOL_ROLES = { get_account_balance: 'read', create_transfer: 'write', get_sensitive_account_details: 'sensitive', get_portfolio_summary: 'a2a' };

export const VERTICALS = {
  banking: {
    castBrand: 'Fabrikam Bank', castHost: 'fabrikam', castUser: 'alex.morgan', castUser2: 'sam.rivera', castOwner2: 'dana.whitfield', castAgent: 'concierge-agent', castAgent2: 'portfolio-specialist', castAgent3: 'research-generalist',
    castAdmin: 'priya.nair', castMoney: 'checking', castReadTool: 'get_account_balance', castWriteTool: 'create_transfer', castSensitiveTool: 'get_sensitive_account_details', castA2aTool: 'get_portfolio_summary',
    castAsset: 'account', castAction: 'transfer', castGroup: 'premium-tier',
  },
  healthcare: {
    castBrand: 'Contoso Health', castHost: 'contoso', castUser: 'grace.liu', castUser2: 'kofi.mensah', castOwner2: 'lena.ortiz', castAgent: 'care-concierge', castAgent2: 'records-specialist', castAgent3: 'research-generalist',
    castAdmin: 'tariq.hassan', castMoney: 'patient billing', castReadTool: 'view_coverage', castWriteTool: 'pay_bill', castSensitiveTool: 'sensitive_patient_records', castA2aTool: 'sensitive_patient_records',
    castAsset: 'coverage record', castAction: 'bill payment', castGroup: 'premium-tier',
  },
  retail: {
    castBrand: 'Northwind Retail', castHost: 'northwind', castUser: 'olu.adeyemi', castUser2: 'anna.berg', castOwner2: 'diego.ruiz', castAgent: 'shopping-concierge', castAgent2: 'orders-specialist', castAgent3: 'research-generalist',
    castAdmin: 'hana.sato', castMoney: 'store credit', castReadTool: 'list_orders', castWriteTool: 'checkout', castSensitiveTool: 'sensitive_order_history', castA2aTool: 'sensitive_order_history',
    castAsset: 'order', castAction: 'checkout', castGroup: 'premium-tier',
  },
};
export const DEFAULT_VERTICAL = 'banking';
export const DEFAULT_CAST = VERTICALS[DEFAULT_VERTICAL];

// Vertical ids named in the source's vertical list, minus banking/healthcare/retail (full packs) and minus one customer-flavoured name that is left out.
// Data stubs: an id and a label, nothing else.
export const STUB_VERTICALS = {
  government: 'Government', university: 'University', workforce: 'Workforce', 'sporting-goods': 'Sporting goods',
  manufacturing: 'Manufacturing', investment: 'Investment', airlines: 'Airlines',
};

export const unfilled = (text, cast) => [...String(text).matchAll(TOKEN)].map((m) => m[1]).filter((k) => !Object.hasOwn(cast, k));
export const fill = (text, cast) => String(text).replace(TOKEN, (m, k) => (Object.hasOwn(cast, k) ? cast[k] : m));
// Iterative, so a deep structure cannot overflow the stack.
export function fillDeep(value, cast) {
  const clone = (x) => (Array.isArray(x) ? [] : x && typeof x === 'object' ? {} : x);
  const outRoot = { v: clone(value) };
  const work = [[value, outRoot, 'v']];
  while (work.length) {
    const [src, dst, key] = work.pop();
    if (typeof src === 'string') { dst[key] = fill(src, cast); continue; }
    if (src === null || typeof src !== 'object') { dst[key] = src; continue; }
    const copy = clone(src);
    dst[key] = copy;
    for (const k of Object.keys(src).reverse()) work.push([src[k], copy, k]);
  }
  return outRoot.v;
}

export const isFullVertical = (id) => typeof id === 'string' && Object.hasOwn(VERTICALS, id);
export const isStubVertical = (id) => typeof id === 'string' && Object.hasOwn(STUB_VERTICALS, id);
export const isKnownVertical = (id) => isFullVertical(id) || isStubVertical(id);
export const verticalFrom = (id) => (isFullVertical(id) ? id : DEFAULT_VERTICAL);
export const verticalList = () => [
  ...Object.entries(VERTICALS).map(([id, c]) => ({ id, label: c.castBrand, pack: 'full' })),
  ...Object.entries(STUB_VERTICALS).map(([id, label]) => ({ id, label, pack: 'stub' })),
];

// Only brand and host as short plain strings from the optional, git-ignored customer.config.json; anything else in the file is ignored.
export function loadCast(file, vertical = DEFAULT_VERTICAL) {
  const cast = { ...VERTICALS[verticalFrom(vertical)] };
  if (!file) return cast;
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [short, key] of [['brand', 'castBrand'], ['host', 'castHost']]) {
      const v = cfg?.cast?.[short];
      if (typeof v !== 'string' || !v.trim()) continue;
      const clean = v.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ').trim().slice(0, MAX_CAST);
      if (/:\/\/|@/.test(clean) || scanHosts(clean).length) continue;
      if (short === 'host' && (!ID.test(clean.toLowerCase()) || clean.includes('.'))) continue;
      cast[key] = short === 'brand' ? clean : clean.toLowerCase();
    }
  } catch { /* no file or not JSON: the defaults */ }
  return cast;
}

// Personas: the signed-in customer. standard = the pack's castUser; premium = castUser2, a member of castGroup (drives UC9 vs UC21).
export const PERSONAS = ['standard', 'premium'];
export const isPersona = (p) => typeof p === 'string' && PERSONAS.includes(p);
export function personaOf(cast, persona) {
  return persona === 'premium'
    ? { key: 'premium', sub: cast.castUser2, groups: [cast.castGroup], tier: 'premium' }
    : { key: 'standard', sub: cast.castUser, groups: [], tier: 'standard' };
}
export const toolFor = (cast, tool) => {
  if (!tool || !Object.hasOwn(TOOL_ROLES, tool)) return tool;
  return { read: cast.castReadTool, write: cast.castWriteTool, sensitive: cast.castSensitiveTool, a2a: cast.castA2aTool }[TOOL_ROLES[tool]];
};
export const roleOf = (tool) => (typeof tool === 'string' && Object.hasOwn(TOOL_ROLES, tool) ? TOOL_ROLES[tool] : null);
