// The lab's INPUTS for each use case that the engine computes (lab-invented, lab-derived from the catalog text). The catalog says what a use case
// shows (title, trigger, solution); it does not carry numbers. These are the numbers and events the lab feeds the engine so the policy rules in
// policy.js produce the outcome. The expected outcome is NOT in this table: it comes from the manifest, and a test compares the engine's computed
// outcome with it for all 87.
//   persona   standard | premium (default standard)
//   amount    the money value of the call, where the tool moves money (thresholds are lab-invented; see policy.js)
//   args      tool arguments the gateway edge policy reads (state, query)
//   event     the hostile or special event the run stages (see flow.js)
//   groupGate the sensitive tool is gated on a group (UC9 vs UC21)
//   rar       pushed authorization_details bound (maxAmount)
//   forgedApproval the client sends a boolean approval flag instead of a verified receipt
//   public    a public catalog call that needs no token
//   chain     a lab-derived chain for use cases whose catalog evidence chain is empty
export const SITUATIONS = {
  UC6: { amount: 2500 },
  UC7: { amount: 600 },
  UC8: { amount: 300 },
  UC22: { amount: 150 },
  UC27: { amount: 600, forgedApproval: true },
  UC48: { amount: 850 },
  UC9: { persona: 'standard', groupGate: true },
  UC21: { persona: 'premium', groupGate: true },
  UC5: { event: 'insufficient-scope' },
  UC10: { event: 'cross-owner-account' },
  UC11: { event: 'wrong-aud' },
  UC12: { event: 'dpop-replay' },
  UC13: { event: 'rogue-actor' },
  UC14: { event: 'rar-exceeded', amount: 900, rar: { maxAmount: 500 } },
  UC14b: { amount: 400, rar: { maxAmount: 500 } },
  UC15: { event: 'tampered-intent-token' },
  UC16: { event: 'impersonation-no-act' },
  UC16b: { event: 'raw-user-token-forwarding' },
  UC18: { event: 'rate-limit-burst', burst: 40 },
  UC29: { event: 'introspection-down' },
  UC24: { public: true },
  UC30: { args: { state: 'TX' } },
  UC31: { args: { state: 'FL' } },
  UC41: { args: { query: 'regional weather outlook' } },
  UC42: { args: { query: 'bitcoin price today' } },
  UC2: { persona: 'standard' },
  'UC-LOGIN': { chain: ['user-token'] },
  'UC-LOGIN-PF': { chain: ['user-token'] },
  'UC-LOGIN-AIC': { chain: ['user-token'] },
  'UC-AIC-TX': { chain: ['user-token', 'token-exchange'] },
  'UC-OBO': { chain: ['user-token', 'token-exchange'] },
};
export const situationOf = (id) => (Object.hasOwn(SITUATIONS, id) ? SITUATIONS[id] : {});
