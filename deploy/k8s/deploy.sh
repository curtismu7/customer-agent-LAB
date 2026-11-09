#!/usr/bin/env bash
# Deploy the hosted, mock-only build of Customer Agent LAB to the SE k8s cluster (rulebook section 6). The first SE deploy of an app is OWNER-APPROVED:
# a real apply refuses unless OWNER_APPROVED=1. This script never builds or pushes an image (the image workflow does) and needs no Secret.
#
#   KUBE_CONTEXT=<ctx> NAMESPACE=<ns> IMAGE=ghcr.io/<owner>/customer-agent-lab:sha-<hex> SE_HOST=<the page's host> CLUSTER_ISSUER=<issuer> \
#     INGRESS_CLASS=<class> deploy/k8s/deploy.sh --dry-run
#   OWNER_APPROVED=1 KUBE_CONTEXT=... NAMESPACE=... IMAGE=... SE_HOST=... CLUSTER_ISSUER=... INGRESS_CLASS=... deploy/k8s/deploy.sh
#
# KUBE_CONTEXT is passed to every kubectl call (no ambient context). IMAGE must be immutable: :sha-<7-40 hex> or @sha256:<64 hex>.
# A read-only preflight lists the existing ingresses on SE_HOST and fails if one that is not ours uses it.
# --dry-run runs the preflight, renders and prints every manifest and fails on any leftover __TOKEN__. It changes nothing.
# After an apply it verifies by CONTENT, not by a 200: in the pod, /api/health says demo-health/1 + ready + this app and /api/info says hosted;
# the pod imageID matches IMAGE; through the public host, /api/health is demo-health/1, the page HTML carries the hosted banner and a mock run
# returns hops. DNS and the certificate can take minutes: the public checks retry (PUBLIC_CHECK_ATTEMPTS, default 30, every PUBLIC_CHECK_SLEEP s, 10).
# Updating later: run it again with a new IMAGE. With kubectl set image, NAME THE CONTAINER (app=...), never '*=', and read the new ReplicaSet.
set -euo pipefail
cd "$(dirname "$0")"

die() { echo "refusing: $*" >&2; exit 2; }
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1
for v in KUBE_CONTEXT NAMESPACE IMAGE SE_HOST CLUSTER_ISSUER INGRESS_CLASS; do [ -n "${!v:-}" ] || die "set $v (see the usage lines at the top of this file)"; done
case "$KUBE_CONTEXT" in *[!A-Za-z0-9._@:/-]*) die "KUBE_CONTEXT has characters that are not allowed";; esac
[[ "$IMAGE" =~ ^[a-z0-9]([a-z0-9._/-]*[a-z0-9])?(:[0-9]+)?(/[a-z0-9._/-]+)*(:sha-[0-9a-f]{7,40}|@sha256:[0-9a-f]{64})$ ]] || die "IMAGE must end in :sha-<7-40 hex digits> or @sha256:<64 hex digits> (latest, HEAD and other mutable tags are refused)"
[[ "$NAMESPACE" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]] || die "NAMESPACE must be a plain DNS label"
HOST_RE='^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
{ [[ "$SE_HOST" =~ $HOST_RE ]] && [ "${#SE_HOST}" -le 253 ]; } || die "SE_HOST must be a fully qualified lower-case host name"
for v in CLUSTER_ISSUER INGRESS_CLASS; do [[ "${!v}" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || die "$v must be a plain name"; done

k() { kubectl --context "$KUBE_CONTEXT" "$@"; }

render() {
  local out
  out=$(sed -e "s|__IMAGE__|$IMAGE|g" -e "s|__SE_HOST__|$SE_HOST|g" -e "s|__CLUSTER_ISSUER__|$CLUSTER_ISSUER|g" -e "s|__INGRESS_CLASS__|$INGRESS_CLASS|g" "$1")
  if grep -qE '__[A-Z_]+__' <<<"$out"; then echo "refusing: unreplaced __TOKEN__ in $1: $(grep -oE '__[A-Z_]+__' <<<"$out" | sort -u | tr '\n' ' ')" >&2; exit 2; fi
  printf '%s\n---\n' "$out"
}
FILES=(deployment.yaml service.yaml certificate.yaml ingress.yaml)

preflight() {
  command -v node >/dev/null 2>&1 || die "node is needed for the ingress preflight"
  local tmp; tmp=$(mktemp); trap 'rm -f "$tmp"' RETURN
  k -n "$NAMESPACE" get ingress -o json >"$tmp" 2>/dev/null || die "preflight: the cluster could not be read with context '$KUBE_CONTEXT'"
  SE_HOST="$SE_HOST" node -e '
    const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    let bad = 0; const lines = [];
    for (const i of j.items || []) for (const r of i.spec?.rules || []) {
      if (r.host !== process.env.SE_HOST) continue;
      const mine = i.metadata.name === "customer-agent-lab";
      lines.push(`${mine ? "ours     " : "COLLISION"} ${r.host} (${i.metadata.name})`);
      if (!mine) bad += 1;
    }
    console.log(lines.length ? lines.join("\n") : "(no existing ingress in this namespace uses the host)");
    process.exit(bad ? 3 : 0);
  ' "$tmp" || die "another ingress already uses $SE_HOST"
}
echo "# preflight (read-only): ingresses on $SE_HOST in $NAMESPACE, context $KUBE_CONTEXT"
preflight

if [ "$DRY" = 1 ]; then
  echo "# DRY RUN: would apply to namespace '$NAMESPACE' (nothing is sent to the cluster)"
  for f in "${FILES[@]}"; do echo "# --- $f"; render "$f"; done
  exit 0
fi

[ "${OWNER_APPROVED:-}" = "1" ] || die "the first SE deploy of each app is owner-approved (set OWNER_APPROVED=1)"
RENDERED=(); for f in "${FILES[@]}"; do RENDERED+=("$(render "$f")"); done
for r in "${RENDERED[@]}"; do printf '%s\n' "$r" | k apply -n "$NAMESPACE" -f -; done
k -n "$NAMESPACE" rollout status deployment/customer-agent-lab --timeout=180s

# ---- verify by content: inside the pod ----
fetch_js='fetch("http://127.0.0.1:5600"+process.argv[1]).then(r=>r.text()).then(t=>console.log(t.slice(0,2000))).catch(e=>{console.log(String(e));process.exit(1)})'
pod_get() { k -n "$NAMESPACE" exec deploy/customer-agent-lab -c app -- node -e "$fetch_js" "$1"; }
health=$(pod_get /api/health)
grep -q '"schema":"demo-health/1"' <<<"$health" && grep -q '"state":"ready"' <<<"$health" && grep -q '"id":"customer-agent-lab"' <<<"$health" \
  || { echo "verify FAILED: in the pod, /api/health is not demo-health/1, ready, customer-agent-lab: $health" >&2; exit 1; }
echo "verify ok: in the pod, /api/health says demo-health/1, ready, customer-agent-lab"
grep -q '"hosted":true' <<<"$(pod_get /api/info)" || { echo "verify FAILED: in the pod, /api/info does not say hosted" >&2; exit 1; }
echo "verify ok: in the pod, /api/info says hosted"
image_id=$(k -n "$NAMESPACE" get pod -l app=customer-agent-lab --field-selector=status.phase=Running -o jsonpath='{.items[0].status.containerStatuses[0].imageID}')
want_repo=${IMAGE%%@*}; want_repo=${want_repo%:*}
case "$image_id" in *"${want_repo##*/}"*) ;; *) echo "verify FAILED: pod imageID '$image_id' does not match IMAGE $IMAGE" >&2; exit 1;; esac
echo "verify ok: pod imageID is $image_id"

# ---- verify by content: through the PUBLIC host ----
retry() { # label, command... (the command prints nothing and exits 0 on success)
  local label=$1; shift; local n=${PUBLIC_CHECK_ATTEMPTS:-30} i
  for ((i = 1; i <= n; i++)); do "$@" && { echo "verify ok: $label"; return 0; }; [ "$i" -lt "$n" ] && sleep "${PUBLIC_CHECK_SLEEP:-10}"; done
  echo "verify FAILED: $label after $n attempt(s): DNS, the certificate or the ingress may not be ready" >&2; exit 1
}
base="https://$SE_HOST"
pub_health() { curl -fsS --max-time 15 "$base/api/health" 2>/dev/null | grep -q '"schema":"demo-health/1"'; }
pub_banner() { curl -fsS --max-time 15 "$base/" 2>/dev/null | grep -q 'data-state="hosted" data-testid="banner">HOSTED AND SIMULATED'; }
pub_run() {
  curl -fsS --max-time 15 -X POST -H 'content-type: application/json' -H "origin: $base" -H 'x-workspace: w-deploy-check' \
    --data '{"vertical":"banking"}' "$base/api/run/UC1" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.exit(j.ok&&j.run.hops.length>0?0:1)})'
}
retry "public GET $base/api/health is demo-health/1" pub_health
retry "public page $base/ carries the hosted banner" pub_banner
retry "public mock run of UC1 returns hops" pub_run
echo "deployed: $base/ (hand the URL over after browser proof)"
