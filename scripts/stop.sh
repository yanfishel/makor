#!/usr/bin/env bash
# Stop whatever scripts/run.sh left on the engine and web ports.
#   scripts/stop.sh            # ENGINE_PORT (8000) and WEB_PORT (3000)
set -uo pipefail

ENGINE_PORT=${ENGINE_PORT:-8000}
WEB_PORT=${WEB_PORT:-3000}

for port in "$ENGINE_PORT" "$WEB_PORT"; do
  pids=$(lsof -ti "tcp:$port" 2>/dev/null || true)
  if [[ -z "$pids" ]]; then
    echo "port $port: nothing running"
    continue
  fi
  echo "port $port: killing $pids"
  kill $pids 2>/dev/null || true
  sleep 1
  left=$(lsof -ti "tcp:$port" 2>/dev/null || true)
  [[ -n "$left" ]] && kill -9 $left 2>/dev/null || true
done
