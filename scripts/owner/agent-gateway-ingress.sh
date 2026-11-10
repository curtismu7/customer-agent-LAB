#!/usr/bin/env bash
# OWNER-RUN. Gives the SE Agent Gateway a public URL: deploy/k8s-owner/agent-gateway-ingress.yaml (Ingress + Certificate).
#
#   scripts/owner/agent-gateway-ingress.sh            # default: read-only preflight + kubectl diff, changes nothing
#   scripts/owner/agent-gateway-ingress.sh --apply    # applies, waits for the certificate, then verifies the public URL
#
# Only kubectl context "us" and namespace "ping-devops-cmuir". --context / --namespace (or KUBE_CONTEXT / NAMESPACE) with any other
# value are refused, and every kubectl call names both explicitly (the ambient context is never used).
# Verify after --apply: GET https://agent-gateway.ai-demo.ping-devops.com/health returns {"ready":true}, and an unauthenticated
# POST /mcp returns 401 with a WWW-Authenticate header. Retries cover DNS and certificate issuance (VERIFY_ATTEMPTS, default 30, every 10 s).
set -euo pipefail

CONTEXT_ONLY=us
NAMESPACE_ONLY=ping-devops-cmuir
HOST=agent-gateway.ai-demo.ping-devops.com
MANIFEST="$(cd "$(dirname "$0")/../.." && pwd)/deploy/k8s-owner/agent-gateway-ingress.yaml"

die() { echo "refusing: $*" >&2; exit 2; }
APPLY=0
CONTEXT="${KUBE_CONTEXT:-$CONTEXT_ONLY}"
NS="${NAMESPACE:-$NAMESPACE_ONLY}"
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --dry-run) APPLY=0; shift ;;
    --context) [ $# -ge 2 ] || die "--context needs a value"; CONTEXT="$2"; shift 2 ;;
    --namespace|-n) [ $# -ge 2 ] || die "--namespace needs a value"; NS="$2"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[ "$CONTEXT" = "$CONTEXT_ONLY" ] || die "kubectl context must be '$CONTEXT_ONLY' (got '$CONTEXT')"
[ "$NS" = "$NAMESPACE_ONLY" ] || die "namespace must be '$NAMESPACE_ONLY' (got '$NS')"
[ -f "$MANIFEST" ] || die "manifest not found: $MANIFEST"
command -v kubectl >/dev/null 2>&1 || die "kubectl is not installed"

k() { kubectl --context "$CONTEXT_ONLY" -n "$NAMESPACE_ONLY" "$@"; }

echo "# preflight (read-only), context $CONTEXT_ONLY, namespace $NAMESPACE_ONLY"
k get service ping-gateway -o jsonpath='{.spec.ports[*].port}' 2>/dev/null | tr ' ' '\n' | grep -qx 8080 \
  || die "service ping-gateway with port 8080 was not found (or the cluster could not be read)"
echo "ok: service ping-gateway has port 8080"
owners=$(k get ingress -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.spec.rules[*].host}{"\n"}{end}' 2>/dev/null) \
  || die "the ingresses could not be listed"
collide=$(printf '%s\n' "$owners" | awk -v h="$HOST" '{ for (i = 2; i <= NF; i++) if ($i == h && $1 != "agent-gateway") print $1 }')
[ -z "$collide" ] || die "another ingress already serves $HOST: $collide"
echo "ok: no other ingress serves $HOST"

echo "# kubectl diff (what --apply would change)"
set +e; k diff -f "$MANIFEST"; rc=$?; set -e
case "$rc" in
  0) echo "(no difference: already applied)" ;;
  1) ;;
  *) die "kubectl diff failed (exit $rc)" ;;
esac

if [ "$APPLY" != 1 ]; then echo "# DRY RUN: nothing was applied. Rerun with --apply."; exit 0; fi

k apply -f "$MANIFEST"
k wait --for=condition=Ready certificate/agent-gateway --timeout=600s

command -v curl >/dev/null 2>&1 || die "curl is needed for the public checks"
attempts="${VERIFY_ATTEMPTS:-30}"; pause="${VERIFY_SLEEP:-10}"
health_ok=0; mcp_ok=0
for i in $(seq 1 "$attempts"); do
  if [ "$health_ok" = 0 ]; then
    body=$(curl -sS --max-time 10 "https://$HOST/health" 2>/dev/null || true)
    if printf '%s' "$body" | grep -Eq '"ready"[[:space:]]*:[[:space:]]*true'; then health_ok=1; echo "verify ok: GET /health says ready:true"; fi
  fi
  if [ "$mcp_ok" = 0 ]; then
    head=$(curl -sS --max-time 10 -o /dev/null -D - -X POST -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
      --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' "https://$HOST/mcp" 2>/dev/null || true)
    if printf '%s' "$head" | head -1 | grep -q ' 401' && printf '%s' "$head" | grep -iq '^www-authenticate:'; then mcp_ok=1; echo "verify ok: unauthenticated POST /mcp is 401 with WWW-Authenticate"; fi
  fi
  [ "$health_ok" = 1 ] && [ "$mcp_ok" = 1 ] && { echo "done: https://$HOST/mcp"; exit 0; }
  [ "$i" -lt "$attempts" ] && sleep "$pause"
done
[ "$health_ok" = 1 ] || echo "verify FAILED: GET https://$HOST/health did not return {\"ready\":true}" >&2
[ "$mcp_ok" = 1 ] || echo "verify FAILED: unauthenticated POST https://$HOST/mcp did not return 401 with WWW-Authenticate" >&2
exit 1
