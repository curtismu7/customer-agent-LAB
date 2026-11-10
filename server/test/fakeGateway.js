// A fake Agent Gateway (MCP over Streamable HTTP) on a loopback port, for the full-Real tests and the e2e. It is not the gateway: it answers
// initialize, notifications/initialized, tools/list and tools/call, records every request (method, headers, body), and checks that the bearer is
// a token the fake PingOne issued by exchange (with act). state.behaviour picks a variant:
//   'ok' | 'sse' (answers as an event stream) | 'deny' (403 + X-Gw-Audit-Trail on tools/call) | 'token' (401 + WWW-Authenticate on initialize)
//   | 'hold' (428 on tools/call) | 'down' (503 on initialize) | 'tool-error' (isError result) | 'no-tool' (tools/list without the tool)
import http from 'node:http';

export const SESSION_ID = 'fake-mcp-session-0001';
export const AUDIT_TRAIL = JSON.stringify([{ stage: 'jwt', result: 'pass' }, { stage: 'authorize', decision: 'DENY', reason: 'fake policy' }]);
const TOOLS = ['get_my_accounts', 'get_account_balance', 'create_transfer', 'get_branch_hours', 'request_fee_waiver', 'view_coverage', 'pay_bill', 'list_orders', 'checkout'];
const RESULTS = {
  get_my_accounts: { accounts: [{ id: 'acct-fake-1', accountType: 'CHECKING', balance: 1200.5 }, { id: 'acct-fake-2', accountType: 'SAVINGS', balance: 80 }] },
  get_account_balance: { account_id: 'acct-fake-1', balance: 1200.5, currency: 'USD' },
  view_coverage: { plan: 'Fake Silver', deductible: 500 },
  list_orders: { orders: [{ id: 'o-1' }, { id: 'o-2' }] },
};

export async function startFakeGateway({ behaviour = 'ok', isDelegated = () => true } = {}) {
  const seen = [];
  const state = { behaviour };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let rpc = null; try { rpc = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { rpc = null; }
      seen.push({ method: req.method, url: req.url, headers: req.headers, rpc });
      const b = state.behaviour;
      const reply = (status, obj, headers = {}) => {
        if (b === 'sse' && status === 200 && obj) { res.writeHead(200, { 'content-type': 'text/event-stream', ...headers }); res.end(`event: message\ndata: ${JSON.stringify(obj)}\n\n`); return; }
        res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(obj ? JSON.stringify(obj) : '');
      };
      if (req.method !== 'POST' || req.url !== '/mcp' || !rpc) return reply(404, { error: 'not_found' });
      const token = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''))?.[1];
      if (b === 'down' && rpc.method === 'initialize') return reply(503, { error: 'unavailable' });
      if (b === 'token' || !token || !isDelegated(token)) return reply(401, { error: 'invalid_token' }, { 'www-authenticate': 'Bearer error="invalid_token", error_description="fake: not a delegated token"' });
      if (rpc.method !== 'initialize' && req.headers['mcp-session-id'] !== SESSION_ID) return reply(400, { jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32600, message: 'fake: no session' } });
      if (rpc.method === 'initialize') return reply(200, { jsonrpc: '2.0', id: rpc.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake-gateway', version: '0' } } }, { 'mcp-session-id': SESSION_ID });
      if (rpc.method === 'notifications/initialized') { res.writeHead(202); res.end(); return undefined; }
      if (rpc.method === 'tools/list') return reply(200, { jsonrpc: '2.0', id: rpc.id, result: { tools: (b === 'no-tool' ? TOOLS.filter((t) => t !== 'get_account_balance') : TOOLS).map((name) => ({ name, inputSchema: { type: 'object' } })) } });
      if (rpc.method === 'tools/call') {
        const name = rpc.params?.name;
        if (name !== 'get_my_accounts') {
          if (b === 'deny') return reply(403, { error: 'forbidden' }, { 'x-gw-audit-trail': AUDIT_TRAIL });
          if (b === 'hold') return reply(428, { error: 'approval_required' });
          if (b === 'tool-error') return reply(200, { jsonrpc: '2.0', id: rpc.id, result: { isError: true, content: [{ type: 'text', text: 'fake: the account was not found' }] } });
        }
        const out = Object.hasOwn(RESULTS, name) ? RESULTS[name] : { ok: true, tool: name };
        return reply(200, { jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: JSON.stringify(out) }] } });
      }
      return reply(200, { jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32601, message: 'fake: unknown method' } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return { seen, state, port, url: `http://127.0.0.1:${port}/mcp`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
