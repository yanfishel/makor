#!/usr/bin/env bash
# Start the Makor stack (engine + web) in one terminal.
#
#   scripts/run.sh <dev|prod> <local|clerk> [--check]
#
#   dev    engine with --reload, web with `next dev`
#   prod   engine with MAKOR_ENV=prod (secret required), web `next build` + `next start`
#   local  AUTH_MODE=none — no sign-in, one implicit user, backend from MAKOR_BACKEND
#   clerk  AUTH_MODE=clerk — Clerk sign-in, Anthropic backend, master key + engine secret required
#   --check  validate the environment and print the resolved settings, start nothing
#
# Reads the repository-root .env (KEY=VALUE lines, the same file both apps use) and
# exports it so Next.js sees the values too. Ports: ENGINE_PORT (8000), WEB_PORT (3000).
# Logs: data/logs/engine.log and data/logs/web.log. Ctrl-C stops both processes;
# scripts/stop.sh kills whatever is left on the two ports.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"

usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

MODE=${1:-}; VARIANT=${2:-}; CHECK_ONLY=0
[[ "${3:-}" == "--check" ]] && CHECK_ONLY=1
[[ "$MODE" == "dev" || "$MODE" == "prod" ]] || usage
[[ "$VARIANT" == "local" || "$VARIANT" == "clerk" ]] || usage

die() { echo "error: $*" >&2; exit 1; }
mask() { local v=$1; [[ -z "$v" ]] && { echo "(unset)"; return; }; echo "${v:0:4}…${v: -2}"; }
# An e-mail address is never printed, not even partially — mask()'s prefix/suffix would still leak one.
presence() { [[ -n "${1:-}" ]] && echo "set" || echo "(unset)"; }

# --- .env -----------------------------------------------------------------------
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

ENGINE_PORT=${ENGINE_PORT:-8000}
WEB_PORT=${WEB_PORT:-3000}
export MAKOR_BACKEND=${MAKOR_BACKEND:-ollama}
export ENGINE_URL="http://127.0.0.1:${ENGINE_PORT}"
export ENGINE_SECRET=${MAKOR_ENGINE_SECRET:-}
export ENGINE_TIMEOUT_MS=${ENGINE_TIMEOUT_MS:-600000}
export DATA_DIR=${DATA_DIR:-$ROOT/data/web}
export NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL:-http://localhost:${WEB_PORT}}
export TRIAL_DOCS=${TRIAL_DOCS:-5}

missing=()
need() { [[ -n "${!1:-}" ]] && return; for m in "${missing[@]-}"; do [[ "$m" == "$1" ]] && return; done; missing+=("$1"); }

case "$VARIANT" in
  local)
    export AUTH_MODE=none
    ;;
  clerk)
    export AUTH_MODE=clerk
    export MAKOR_BACKEND=anthropic
    need CLERK_SECRET_KEY; need CLERK_PUBLISHABLE_KEY
    need MAKOR_MASTER_KEY; need MAKOR_ENGINE_SECRET
    export NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${CLERK_PUBLISHABLE_KEY:-}
    export MAKOR_ADMIN_EMAIL=${MAKOR_ADMIN_EMAIL:-}
    ;;
esac

if [[ "$MODE" == "prod" ]]; then
  export MAKOR_ENV=prod
  need MAKOR_ENGINE_SECRET
else
  export MAKOR_ENV=dev
fi

[[ "$MAKOR_BACKEND" == "anthropic" ]] && need ANTHROPIC_API_KEY

if (( ${#missing[@]} )); then
  echo "error: missing in .env for '$MODE $VARIANT': ${missing[*]}" >&2
  for v in "${missing[@]}"; do
    case "$v" in
      MAKOR_ENGINE_SECRET)   echo "  MAKOR_ENGINE_SECRET=\$(openssl rand -hex 32)" >&2 ;;
      MAKOR_MASTER_KEY)      echo "  MAKOR_MASTER_KEY=\$(openssl rand -base64 32)" >&2 ;;
      CLERK_*)               echo "  $v — from https://dashboard.clerk.com (or: clerk env pull)" >&2 ;;
      ANTHROPIC_API_KEY)     echo "  ANTHROPIC_API_KEY — from https://console.anthropic.com" >&2 ;;
    esac
  done
  exit 1
fi

# --- tooling ----------------------------------------------------------------------
# rapidocr-onnxruntime is installed separately, --no-deps: it declares opencv-python and
# this engine deliberately uses opencv-python-headless (see engine/requirements.txt).
[[ -x .venv/bin/uvicorn ]] || die "no .venv/bin/uvicorn — run: python3 -m venv .venv && .venv/bin/pip install -r engine/requirements.txt && .venv/bin/pip install --no-deps rapidocr-onnxruntime==1.2.3"
command -v npm >/dev/null || die "npm not found"

if [[ "$MAKOR_BACKEND" == "ollama" ]]; then
  OLLAMA=${MAKOR_OLLAMA_URL:-http://localhost:11434}
  MODEL=${MAKOR_MODEL:-qwen3-vl:8b-instruct}
  tags=$(curl -sf --max-time 3 "$OLLAMA/api/tags" 2>/dev/null) || die "Ollama not reachable at $OLLAMA — start it (brew services start ollama) or set MAKOR_BACKEND=anthropic"
  grep -q "\"name\":\"$MODEL\"" <<<"$tags" || die "model $MODEL not pulled — run: ollama pull $MODEL"
fi

cat <<EOF
Makor $MODE / $VARIANT
  engine   http://127.0.0.1:$ENGINE_PORT  backend=$MAKOR_BACKEND model=${MAKOR_MODEL:-default} env=$MAKOR_ENV secret=$(mask "$ENGINE_SECRET")
  web      http://localhost:$WEB_PORT  AUTH_MODE=$AUTH_MODE DATA_DIR=$DATA_DIR timeout=${ENGINE_TIMEOUT_MS}ms
  keys     anthropic=$(mask "${ANTHROPIC_API_KEY:-}") master=$(mask "${MAKOR_MASTER_KEY:-}") clerk_pk=$(mask "${CLERK_PUBLISHABLE_KEY:-}") admin=$(presence "${MAKOR_ADMIN_EMAIL:-}")
EOF
(( CHECK_ONLY )) && { echo "check ok"; exit 0; }

for port in "$ENGINE_PORT" "$WEB_PORT"; do
  if lsof -ti "tcp:$port" >/dev/null 2>&1; then
    die "port $port is busy — run scripts/stop.sh first (or set ENGINE_PORT/WEB_PORT)"
  fi
done

[[ -d web/node_modules ]] || { echo "installing web dependencies…"; (cd web && npm ci); }

# --- start --------------------------------------------------------------------------
mkdir -p data/logs "$DATA_DIR"
: > data/logs/engine.log; : > data/logs/web.log

pids=()
cleanup() {
  trap - INT TERM EXIT
  echo; echo "stopping…"
  for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done
  # next dev/start fork workers that outlive the npm process
  lsof -ti "tcp:$WEB_PORT" 2>/dev/null | xargs kill 2>/dev/null || true
  lsof -ti "tcp:$ENGINE_PORT" 2>/dev/null | xargs kill 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

engine_args=(app.main:app --host 127.0.0.1 --port "$ENGINE_PORT")
[[ "$MODE" == "dev" ]] && engine_args+=(--reload)
(cd engine && exec ../.venv/bin/uvicorn "${engine_args[@]}") >>data/logs/engine.log 2>&1 &
pids+=($!)

for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$ENGINE_PORT/healthz" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -sf "http://127.0.0.1:$ENGINE_PORT/healthz" >/dev/null || { cat data/logs/engine.log >&2; die "engine did not come up"; }
echo "engine up"

if [[ "$MODE" == "prod" ]]; then
  echo "building web…"
  (cd web && npm run build) >>data/logs/web.log 2>&1 || { tail -40 data/logs/web.log >&2; die "web build failed (see data/logs/web.log)"; }
  (cd web && exec npm start -- -p "$WEB_PORT") >>data/logs/web.log 2>&1 &
else
  (cd web && exec npm run dev -- -p "$WEB_PORT") >>data/logs/web.log 2>&1 &
fi
pids+=($!)

for _ in $(seq 1 120); do
  curl -so /dev/null "http://localhost:$WEB_PORT/" 2>/dev/null && break
  sleep 0.5
done
curl -so /dev/null "http://localhost:$WEB_PORT/" || { tail -40 data/logs/web.log >&2; die "web did not come up"; }
echo "web up → http://localhost:$WEB_PORT/app/extract"
echo "logs: data/logs/engine.log, data/logs/web.log (Ctrl-C stops both)"

tail -n 0 -F data/logs/engine.log data/logs/web.log &
pids+=($!)
wait "${pids[0]}" "${pids[1]}"
