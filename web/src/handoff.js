// Hand-off targets. A use case whose route is Hand off (or Here + go deeper) names the standalone app that covers it. The link to that app is built
// only from this fixed allow-list (app id -> lab-proxy path), never from anything typed or read from the address bar, so there is no open redirect.
// Only when this page itself is served under the lab proxy (its path starts with /customer-agent/) is there a link, and then it is RELATIVE: the
// other app sits beside this one under the same proxy. Served on its own port, the page says "Start <app> from the Shelf" and shows no link.
// What travels in the link: ids only (from, uc, vertical, user = the persona id). Never a token, a secret, a cookie or user data. The card lists
// exactly what handoffCarry returns, and handoffHref builds the query from the same list (one source of truth).

// Paths from the lab-proxy route table (shared/lab-proxy/nginx.conf and the shelf's PROXY_PATHS; paths only), keyed by the app ids the routing
// table uses. Where the table's id differs from the proxy path, the shelf entry (same port, same title) confirms they are one app:
// cimd = the shelf's cimd-lab ("CIMD Lab"), privilege-a2a-anthropic-demo = the proxy's /privilege-a2a/. Owner confirmed 2026-11-09:
// pingfederate = /pingfederate-lab/, id-jag-standalone = /id-jag-kit/. 2026-11-09: ten more routes on lab-proxy main (AI-DEMO-Standalone #130),
// checked through the proxy; pingone-signin = /pingone-signin-lab/, agent-audit-trail = /agent-audit-trail-lab/. Apps with no proxy route get no link.
export const PROXY_PATHS = Object.freeze({
  "a2a-lab": "/a2a-lab/",
  "agent-audit-trail": "/agent-audit-trail-lab/",
  "agent-governance-lab": "/agent-governance-lab/",
  "agent-kill-switch": "/agent-kill-switch/",
  "agent-registry-demo": "/agent-registry-demo/",
  "ai-guard-sidecar": "/ai-guard-sidecar/",
  "ciba-hitl-lab": "/ciba-hitl-lab/",
  cimd: "/cimd-lab/",
  "delegation-lab": "/delegation-lab/",
  "gateway-suite-lab": "/gateway-suite/",
  "hitl-mfa-lab": "/hitl-mfa-lab/",
  "id-jag-standalone": "/id-jag-kit/",
  "intent-par-inspector": "/intent-par-inspector/",
  "jev-lab": "/jev-lab/",
  "jit-lab": "/jit-lab/",
  "mcp-gateway-lab": "/mcp-gateway-lab/",
  "mcp-tools": "/mcp-tools/",
  "meridian-a2a-hop": "/meridian-a2a-hop/",
  "mock-authorize": "/mock-authorize/",
  muse: "/muse/",
  "no-tool-no-promise": "/no-tool-no-promise/",
  "obo-lab": "/obo-lab/",
  pingfederate: "/pingfederate-lab/",
  "pingone-mcp-inspector": "/pingone-mcp-inspector/",
  "pingone-signin": "/pingone-signin-lab/",
  "privilege-a2a-anthropic-demo": "/privilege-a2a/",
  "progressive-trust-ladder": "/progressive-trust-ladder/",
  "stolen-token-lab": "/stolen-token-lab/",
  "token-workbench": "/token-workbench/",
  "worker-demo": "/worker-demo/",
});
export const SELF_PREFIX = "/customer-agent/";
const ID = /^[A-Za-z0-9.-]{1,40}$/;

export const ROUTE_LABEL = { Here: "Runs here", "Here + go deeper": "Runs here, go deeper", "Hand off": "Hands off", Guide: "Guide" };
export const routeOf = (u) => (u?.route && typeof u.route.route === "string" ? u.route : { route: "Here", app: null, basis: null });
export const isHandoff = (u) => routeOf(u).route === "Hand off";
export const isDeeper = (u) => routeOf(u).route === "Here + go deeper";
// The app, then the optional second choice (`also`, Hand off rows only), as one list and as words.
export const appsOf = (r) => [r?.app, r?.also].filter(Boolean);
export const appsText = (r) => appsOf(r).join(" or ");

// What the link carries, in order: [[name, value], ...]. uc and vertical must be id-shaped (else null: no link and nothing to list); the user
// (the persona id, e.g. alex.morgan) is carried only when it is id-shaped too.
export function handoffCarry(uc, vertical, user) {
  if (!ID.test(String(uc)) || !ID.test(String(vertical))) return null;
  const out = [["from", "customer-agent"], ["uc", String(uc)], ["vertical", String(vertical)]];
  if (typeof user === "string" && ID.test(user)) out.push(["user", user]);
  return out;
}

// The relative link to `app` for use case `uc` in `vertical` (and `user`), or null when there must be no link. The prefix check runs on the
// pathname with repeated slashes folded (the proxy folds them too); the climb counts the segments of the pathname as the browser resolves it,
// empty ones included, so "/customer-agent//" still lands on "/<app>/".
export function handoffHref(app, uc, vertical, pathname, user) {
  if (typeof pathname !== "string" || !pathname.replace(/\/{2,}/g, "/").startsWith(SELF_PREFIX)) return null;
  if (typeof app !== "string" || !Object.hasOwn(PROXY_PATHS, app)) return null;
  const carry = handoffCarry(uc, vertical, user);
  if (!carry) return null;
  const dir = pathname.slice(0, pathname.lastIndexOf("/") + 1);
  const up = "../".repeat(dir.split("/").length - 2);
  return `${up}${PROXY_PATHS[app].slice(1)}?${new URLSearchParams(carry).toString()}`;
}

export const currentPath = () => { try { return window.location.pathname; } catch { return "/"; } };
// Same tab: the lab proxy keeps one lab cookie per browser, so a second tab would send this page's API calls to the other app.
export const go = (href) => { if (href) window.location.assign(href); };
