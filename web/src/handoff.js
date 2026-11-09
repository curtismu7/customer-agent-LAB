// Hand-off targets. A use case whose route is Hand off (or Here + go deeper) names the standalone app that covers it. The link to that app is built
// only from this fixed allow-list (app id -> lab-proxy path), never from anything typed or read from the address bar, so there is no open redirect.
// Only when this page itself is served under the lab proxy (its path starts with /customer-agent/) is there a link, and then it is RELATIVE: the
// other app sits beside this one under the same proxy. Served on its own port, the page says "Start <app> from the Shelf" and shows no link.
// What travels in the link: ids only (from, uc, vertical). Never a token, a secret, a cookie or user data.

// Paths copied from the shelf's lab-proxy route table (paths only), for the apps the routing table hands off to.
export const PROXY_PATHS = Object.freeze({
  "a2a-lab": "/a2a-lab/",
  "agent-kill-switch": "/agent-kill-switch/",
  "agent-registry-demo": "/agent-registry-demo/",
  "ai-guard-sidecar": "/ai-guard-sidecar/",
  "ciba-hitl-lab": "/ciba-hitl-lab/",
  "delegation-lab": "/delegation-lab/",
  "gateway-suite-lab": "/gateway-suite/",
  "hitl-mfa-lab": "/hitl-mfa-lab/",
  "mcp-gateway-lab": "/mcp-gateway-lab/",
  "meridian-a2a-hop": "/meridian-a2a-hop/",
  "no-tool-no-promise": "/no-tool-no-promise/",
  "privilege-demo": "/privilege-demo/",
  "token-workbench": "/token-workbench/",
});
export const SELF_PREFIX = "/customer-agent/";
const ID = /^[A-Za-z0-9.-]{1,40}$/;

export const ROUTE_LABEL = { Here: "Runs here", "Here + go deeper": "Runs here, go deeper", "Hand off": "Hands off", Guide: "Guide" };
export const routeOf = (u) => (u?.route && typeof u.route.route === "string" ? u.route : { route: "Here", app: null, basis: null });
export const isHandoff = (u) => routeOf(u).route === "Hand off";
export const isDeeper = (u) => routeOf(u).route === "Here + go deeper";

// The relative link to `app` for use case `uc` in `vertical`, or null when there must be no link.
export function handoffHref(app, uc, vertical, pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith(SELF_PREFIX)) return null;
  if (typeof app !== "string" || !Object.hasOwn(PROXY_PATHS, app)) return null;
  if (!ID.test(String(uc)) || !ID.test(String(vertical))) return null;
  const dir = pathname.slice(0, pathname.lastIndexOf("/") + 1);
  const up = "../".repeat(dir.split("/").filter(Boolean).length);
  const q = new URLSearchParams({ from: "customer-agent", uc, vertical });
  return `${up}${PROXY_PATHS[app].slice(1)}?${q.toString()}`;
}

export const currentPath = () => { try { return window.location.pathname; } catch { return "/"; } };
// Same tab: the lab proxy keeps one lab cookie per browser, so a second tab would send this page's API calls to the other app.
export const go = (href) => { if (href) window.location.assign(href); };
