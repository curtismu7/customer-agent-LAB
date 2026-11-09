# Customer Agent LAB: where each use case runs

Owner rule (2026-11-08): **if a standalone app covers a use case, it runs there; if it is simple, it stays in Customer Agent LAB.** Simple use cases that a lab also covers stay here and get a "Go deeper" link.

This table is the tracking copy. Edit a row to change where a use case goes; Step 1 of the build turns it into the app's `handoff.json` and a test pins it.

| Route | Count | Meaning |
|---|---|---|
| Here | 15 | Runs in this app, one agent, the mock engine decides |
| Here + go deeper | 9 | Runs here, plus a link to the lab that covers it in depth |
| Hand off | 52 | Opens the standalone app (same tab, ids only, Back returns here) |
| Guide | 11 | Learning page or script, no lab yet |
| **Total** | **87** | 28 different hand-off apps |

Basis: named in lab entry 18, matches lab description 34, owner confirmed 7, owner decision 7, my guess 0.

Status values: `todo`, `agreed`, `built`, `verified`.

| UC | Title | Track | Route | App | Basis | Status | Notes |
|---|---|---|---|---|---|---|---|
| UC1 | Delegated access (consent only) | foundations | Here + go deeper | delegation-lab | named in lab entry | todo |  |
| UC2 | A2A delegation | foundations | Hand off | a2a-lab | named in lab entry | todo |  |
| UC2.5 | A2A Orchestrator — Interactive Learning | foundations | Hand off | meridian-a2a-hop | matches lab description | todo |  |
| UC2.7 | A2A end to end — protocol + identity | learn | Hand off | a2a-lab | named in lab entry | todo |  |
| UC2.6 | A2A generalist mismatch | foundations | Hand off | a2a-lab | named in lab entry | todo |  |
| UC3 | act gate | foundations | Here |  |  | todo |  |
| UC19 | Non-human (agent) identity lifecycle | foundations | Here + go deeper | agent-registry-demo | matches lab description | todo |  |
| UC20 | Agent observability and traceability | foundations | Here + go deeper | agent-audit-trail | matches lab description | todo |  |
| UC33 | My mortgage | foundations | Here |  |  | todo |  |
| UC34 | Spot unusual patterns | foundations | Here |  | owner decision 2026-11-09 | agreed | agent-audit-trail correlates but does not detect patterns |
| UC35 | Why was that blocked? | foundations | Here |  |  | todo |  |
| UC4 | Overscoped agent | controls | Here |  |  | todo |  |
| UC6 | Authz denied | controls | Here + go deeper | mock-authorize | matches lab description | todo |  |
| UC7 | MFA step-up (HITL) | hitl | Here + go deeper | hitl-mfa-lab | named in lab entry | todo |  |
| UC8 | MFA + HITL consent | hitl | Here + go deeper | hitl-mfa-lab | named in lab entry | todo |  |
| UC9 | Group / entitlement check | controls | Here + go deeper | delegation-lab | named in lab entry | todo |  |
| UC9A | Group / entitlement check — live board | controls | Hand off | delegation-lab | named in lab entry | todo |  |
| UC21 | Entitlement-tiered capability | controls | Here + go deeper | delegation-lab | named in lab entry | todo |  |
| UC22 | CIBA out-of-band approval | hitl | Hand off | hitl-mfa-lab | named in lab entry | todo |  |
| UC23 | Progressive trust demo — presenter guide | demo | Hand off | progressive-trust-ladder | matches lab description | todo |  |
| UC24 | Act 1 — Public catalog access | demo | Here |  |  | todo |  |
| UC26 | Proof of enforcement — live verdict on every use case | demo | Here |  |  | todo |  |
| UC5 | Wrong / insufficient scope | attacks | Here |  |  | todo |  |
| UC10 | Resource-ownership / account takeover | attacks | Here |  |  | todo |  |
| UC11 | Bad client → agent gateway | attacks | Here |  |  | todo |  |
| UC12 | Token theft / replay defense | attacks | Hand off | stolen-token-lab | matches lab description | todo |  |
| UC13 | Confused-deputy actor injection | attacks | Here |  |  | todo |  |
| UC14 | PAR + RAR intent violation (pushed intent exceeded) | attacks | Hand off | intent-par-inspector | matches lab description | todo |  |
| UC14b | PAR + RAR intent verified (PERMIT) | learn | Hand off | intent-par-inspector | named in lab entry | todo |  |
| UC15 | Intent-token tampering | attacks | Hand off | intent-par-inspector | matches lab description | todo |  |
| UC16 | Impersonation blocked (OBO required) | attacks | Hand off | obo-lab | matches lab description | todo |  |
| UC16b | Raw user-token forwarding blocked (Zero Trust) | attacks | Here |  |  | todo |  |
| UC17 | JIT / ephemeral credentials | controls | Hand off | jit-lab | matches lab description | todo |  |
| UC18 | Rate-limit / resource-overload defense | attacks | Hand off | agent-kill-switch | matches lab description | todo |  |
| UC29 | Token-validation outage — fail closed | attacks | Here |  |  | todo |  |
| UC30 | Third-party MCP server, scoped at the gateway | controls | Hand off | mcp-gateway-lab | named in lab entry | todo |  |
| UC31 | Third-party MCP server — out-of-scope call denied | controls | Hand off | mcp-gateway-lab | named in lab entry | todo |  |
| UC32 | Live-reconfigure the gateway's scope policy | controls | Hand off | mcp-gateway-lab | named in lab entry | todo |  |
| UC41 | Third-party search server, filtered at the gateway | controls | Here |  | owner decision 2026-11-09 | agreed |  |
| UC42 | Third-party search server — blocked query denied | controls | Here |  | owner decision 2026-11-09 | agreed |  |
| UC-TOOL1 | Protected RAG | tools | Guide |  |  | todo |  |
| UC-TOOL2 | Code Explorer | tools | Guide |  |  | todo |  |
| UC-TOOL3 | LLM Gateway | tools | Hand off | gateway-suite-lab | owner confirmed 2026-11-09 | agreed |  |
| UC46 | Privilege A2A access review | tools | Hand off | privilege-a2a-anthropic-demo | matches lab description | todo |  |
| UC46A | Privilege A2A access review in the agent | tools | Hand off | privilege-a2a-anthropic-demo | matches lab description | todo |  |
| UC47 | Privilege A2A three-deep agent chain | tools | Hand off | privilege-a2a-anthropic-demo | matches lab description | todo |  |
| UC-MUSE1 | Your agent, our gateway (external agent, standard lane) | tools | Hand off | muse | matches lab description | todo |  |
| UC-MUSE2 | Your agent, the Agent Privilege (external agent, lane 2) | tools | Hand off | muse | matches lab description | todo |  |
| UC-NHI1 | Live agent NHI inventory | nhi | Hand off | agent-governance-lab | matches lab description | todo |  |
| UC-NHI2 | Agent lifecycle export (JML) | nhi | Hand off | agent-registry-demo | matches lab description | todo |  |
| UC-LEARN1 | OAuth Academy | learn | Guide |  |  | todo |  |
| UC-LEARN2 | PingOne MCP Inspector | learn | Hand off | pingone-mcp-inspector | named in lab entry | todo |  |
| UC-LEARN3 | Generic MCP Inspector | learn | Hand off | mcp-tools | named in lab entry | todo |  |
| UC-LEARN4 | MCP Tools | learn | Hand off | mcp-tools | matches lab description | todo |  |
| UC-LEARN5 | Learning Hub | learn | Guide |  |  | todo |  |
| UC-LEARN6 | Token Flow (Interactive) | learn | Hand off | token-workbench | owner confirmed 2026-11-09 | agreed |  |
| UC-LEARN7 | The Ungoverned Agent (OpenCLI) | learn | Guide |  |  | todo |  |
| UC-PAM-SETUP | Privilege Demo — SE Setup | learn | Guide |  | owner decision 2026-11-09 | agreed | SE presenter guide for the shared Privilege environment; stays in AI-DEMO2 /privilege-demo |
| UC-PAM-SCRIPT | Privilege Demo — Request Access Script | learn | Guide |  | owner decision 2026-11-09 | agreed | SE presenter script for the shared Privilege environment; stays in AI-DEMO2 /privilege-demo |
| UC-LEARN8 | Enterprise-Managed MCP Authorization | learn | Hand off | id-jag-standalone | matches lab description | todo | proxy path /id-jag-kit/ (owner confirmed 2026-11-09) |
| UC-LEARN9 | ID-JAG / Cross-App Access | learn | Hand off | id-jag-standalone | named in lab entry | todo | proxy path /id-jag-kit/ (owner confirmed 2026-11-09) |
| UC-LEARN10 | Orchestration SDK (Custom UI) | learn | Guide |  |  | todo |  |
| UC-LEARN12 | PingFederate DaVinci Integration Kit | learn | Hand off | pingfederate | matches lab description | todo | proxy path /pingfederate-lab/ (owner confirmed 2026-11-09) |
| UC-LEARN13 | PingFederate RAR — the authorization server refuses an out-of-policy transfer | learn | Hand off | pingfederate | matches lab description | todo | proxy path /pingfederate-lab/ (owner confirmed 2026-11-09) |
| UC-LEARN14 | CIBA human approval — PingFederate or PingOne, by how you signed in | learn | Hand off | ciba-hitl-lab | matches lab description | todo |  |
| UC-LEARN15 | Jev decision model — System One vs System Two | learn | Hand off | jev-lab | matches lab description | todo |  |
| UC-LEARN11 | Privilege LLM — prompt injection blocked | learn | Hand off | ai-guard-sidecar | owner confirmed 2026-11-09 | agreed |  |
| UC-LEARN16 | MFA Test — FIDO2 passkey ceremony | learn | Hand off | pingone-signin | owner confirmed 2026-11-09 | agreed | TODO: add a passkey (FIDO2) ceremony to pingone-signin-LAB; it has none yet |
| UC-LEARN17 | OAuth Debug — live token flow log | learn | Hand off | token-workbench | owner confirmed 2026-11-09 | agreed | TODO: add Real mode to token-workbench (mock only today); the live log needs it |
| UC-LEARN18 | LLM Test — raw provider chat | learn | Guide |  |  | todo |  |
| UC-LEARN19 | Intent Inspector — PAR/RAR payloads | learn | Hand off | intent-par-inspector | named in lab entry | todo |  |
| UC25 | Enterprise-managed MCP access | controls | Hand off | id-jag-standalone | matches lab description | todo | proxy path /id-jag-kit/ (owner confirmed 2026-11-09) |
| UC39 | Centralized MCP revocation | controls | Hand off | agent-kill-switch / agent-registry-demo | owner decision 2026-11-09 | agreed | Two options: operator kill switch, or retire the agent in the registry |
| UC40 | Enterprise-Managed MCP Authorization (native ID-JAG) | controls | Hand off | id-jag-standalone | matches lab description | todo | proxy path /id-jag-kit/ (owner confirmed 2026-11-09) |
| UC-LOGIN | PingOne login (OIDC + PKCE) | demo | Hand off | pingone-signin | matches lab description | todo |  |
| UC-LOGIN-PF | PingFederate login (OIDC + PKCE) | demo | Hand off | pingfederate | matches lab description | todo | proxy path /pingfederate-lab/ (owner confirmed 2026-11-09) |
| UC-LOGIN-AIC | AIC login (federated through PingOne) | demo | Guide |  |  | todo |  |
| UC-AIC-TX | AIC token exchange (delegation) | demo | Guide |  |  | todo |  |
| UC-OBO | On-behalf-of delegation (OBO inspector) | demo | Hand off | obo-lab | matches lab description | todo |  |
| UC27 | HITL consent bypass attempt | hitl | Here + go deeper | hitl-mfa-lab | owner confirmed 2026-11-09 | agreed |  |
| UC28 | Tool set as the authorization boundary (airline chatbot-liability pattern) | controls | Hand off | no-tool-no-promise | matches lab description | todo |  |
| UC37 | Verified Trust — signed agent assertion on A2A delegation | controls | Hand off | a2a-lab | matches lab description | todo |  |
| UC38 | Workload Agent: MFA-gated protected action | foundations | Hand off | worker-demo | matches lab description | todo |  |
| UC43 | Consumer & Partner Agent — CIMD registration | foundations | Hand off | cimd | matches lab description | todo |  |
| UC44 | Workload Agent: OBO customer-data read | foundations | Hand off | obo-lab | matches lab description | todo |  |
| UC45 | SaaS-Embedded Agent — Website Worker | foundations | Hand off | worker-demo | owner confirmed 2026-11-09 | agreed | worker-demo needs the Privilege demo running (port 4510) |
| UC48 | Consumer Agent — governed flight booking | foundations | Hand off | muse | owner decision 2026-11-09 | agreed | muse has no lab-proxy route yet (Step 3) |

Source: `data/usecases.json` (87 ids, 2026-11-08) and each lab's `docs/shelf-entry.json`. Generated once; edit by hand from here.
