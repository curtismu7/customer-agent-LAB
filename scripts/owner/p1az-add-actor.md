# Owner checklist: add the lab's agent to HasValidActorChain (PingOne Authorize)

The Agent Gateway asks PingOne Authorize for a decision on every MCP call. The policy denies any delegated token whose actor is not listed in the
condition `HasValidActorChain` (`mcp-invalid-actor`). The lab's new agent app ("Customer Agent LAB Agent", created by
`scripts/owner/pingone-real-setup.mjs`) is not listed yet. This checklist adds it.

**ADDITIVE ONLY.** The list never shrinks: other demos share this policy, and every id on it is a live actor somewhere. You add exactly one id and
change nothing else.

**Why the export and the diff matter.** Importing an older policy snapshot once dropped an accepted audience and every agent call was denied. So you
never import a snapshot to make this change, and you compare before you save.

## Why this is a console checklist, not a script

The Authorize policy-editor API (`/authorizationPolicies`, `/trustFramework/...`) refuses worker (client credentials) tokens with 403, even with
Environment Admin and the Authorize roles (measured in AI-DEMO2, 2026-07-10). Only the decision API (`/decisionEndpoints`) accepts a worker token.
An admin worker therefore cannot read or edit the condition, so no script is shipped. If that changes, a script must still show the diff and require
`--apply`.

## Before you start

1. You ran `node scripts/owner/pingone-real-setup.mjs --apply`, and it printed the agent client id's first 8 characters.
2. Copy the full id from the lab's `.env` (it is not a secret, but keep it out of chat and commits):
   `grep ^CAL_AGENT_CLIENT_ID= .env`

## Steps (PingOne console, the lab's environment)

1. **Export first.** Open Authorize, then the policy the Agent Gateway's decision endpoint uses. Export the current policy (snapshot) and save it
   as `before.json` outside any git repo. This is your rollback and your diff base.
2. Open Trust Framework, then Conditions, then **HasValidActorChain**.
3. Read the list: it is an OR of clauses `ActClientId Equals <client id>`. If the lab's id is already there, stop: nothing to do.
4. **Add one clause** to the existing OR: `ActClientId` `Equals` `<the full CAL_AGENT_CLIENT_ID>`. Do not edit, reorder or remove any other
   clause, and do not touch the "absent actor" exemption.
5. Save the condition (this edit only; never a snapshot import). Saving changes the policy draft; the decision endpoint keeps serving the
   deployed version until step 8, unless the endpoint is set to follow the latest version (check its settings first; UNVERIFIED for this
   environment). If it follows the latest, do steps 7 and 8 right away.
6. **Check HasValidMcpAudience** (read only): open Trust Framework, Conditions, **HasValidMcpAudience**. Its accepted audiences must include
   `mcpgateway.ping.demo` (the audience the lab's tokens carry). If it is missing, STOP and tell the builder: adding an audience is a separate,
   reviewed change, not part of this checklist.
7. **Export again** as `after.json` and diff it against `before.json`:
   `diff <(node -e 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[1])),null,1))' before.json) <(node -e 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[1])),null,1))' after.json)`
   Expected: only the HasValidActorChain object changes, by exactly one added id (plus its version or description fields). Count the ids:
   `grep -o '<first 8 characters of the id>' after.json | wc -l` is at least 1 and `before.json` has 0.
   Anything else changed (an audience gone, another id gone, another condition edited): restore `before.json` in the console and stop.
8. **Deploy** the policy version the way you normally do (Authorize, Deploy), so the decision endpoint serves it.

## Prove it

Run one Real gateway call from the lab (Real mode, any use case that reaches the gateway). Expect PERMIT where it used to say
`mcp-invalid-actor`. A deny that names another condition is a different problem: record it, do not widen the policy to make it pass.

## Rollback

Import `before.json` (it is the exact current state, so nothing else is lost), then deploy.
