# Talk track

<!-- Generated from server/src/data.js by `npm run talk-track`. Do not edit by hand. -->

> SIMULATED. SIMULATED, MOCK mode: a mock engine produces every token, hop and decision offline. Tokens are labelled MOCK and signed with a public mock key. Thresholds, personas and event staging are the lab's own (lab-invented); the use cases come from the AI-DEMO2 catalog. No tenant, gateway or identity provider is touched.

## Start with the question

Fabrikam Bank has a customer-facing agent, concierge-agent. A customer, alex.morgan, can ask it for a balance or for a transfer. The question is not whether the agent is clever: it is whether anyone can prove who allowed each thing it did.

## Eight tracks, 87 use cases

The catalog has 87 use cases in eight tracks: foundations (15), learn (23), controls (16), hitl (4), demo (8), attacks (11), tools (8) and nhi (2). Pick any one and run it: every hop shows the raw request and response and a W3C traceparent.

## Delegation, not impersonation

alex.morgan consents, the identity provider exchanges the user token and the agent token (RFC 8693) for a delegated token whose act claim names concierge-agent. The gateway and the policy engine check that chain on every call.

## Step-up and human approval

A small transfer goes straight through. A larger one needs step-up, a larger one still needs a human approval receipt, and the largest is denied. The thresholds are the lab's own, chosen to match the catalog's example amounts.

## What the gateway refuses

Eleven attacks run in mock: wrong scope, wrong audience, a replayed proof, a forged actor, an exceeded intent, a missing act claim, a burst of calls, a validation outage. Each ends in the refusal the catalog names, and nothing reaches the tool.

## Mock and live

Mock runs a whole use case offline. (If the owner turned on the local llama.cpp brain, the model only picks which use case to run; it never writes the answer, and the reasoning says so.) Live, which the owner switches on, makes two real calls to one identity provider environment: its discovery document and the agent's own token. It stops there, with no customer sign-in, no gateway and no tool call, and it lists the steps it did not run. That is what this lab can honestly show against a real tenant.

## What is simulated

In Mock, everything. The tokens are mock and labelled. The use cases and their expected outcomes are the catalog's; the amounts, the events and the persona that make each one happen are the lab's. Use cases that need a feature flag run in mock and say what live feature they need.

## Why it matters: a customer-facing agent that cannot overreach

Challenge: A customer-facing AI agent can be asked to do anything, by the customer or by someone pretending to be them. Without a token chain, a policy decision and a gateway, nobody can show who authorized what. Technical: Delegation with an act claim (RFC 8693), a policy decision on every call, step-up and human approval for risky writes, and a gateway that fails closed. Business: Every agent action traces back to a person who consented, so a refused or approved action can be explained. (Lab summary of the AI-DEMO2 catalog text, not a Ping claim.)

## Not demonstrated

- Anything about how a real identity provider, gateway or policy engine behaves: nothing here ran against one.
- Live mode reaches the identity provider only (discovery and the agent's client-credentials token). Sign-in, token exchange, gateway, authorize and tool steps are not run live, and a live run does not recompute the use case's outcome.
- The live path has not been run against a real tenant by the builder: UNVERIFIED. The owner runs it.
- The thresholds that decide step-up, approval and deny (lab-invented), the events that stage each attack, and the persona that drives group checks.
- Seven verticals are data stubs (a name only); only banking, healthcare and retail have full packs.
- Guided use cases (learning pages, presenter guides, A2A reviews, the NHI inventory): the lab opens a stand-in step and does not recompute their outcome.
