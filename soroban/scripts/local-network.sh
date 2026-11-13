#!/usr/bin/env bash
# Start (or reuse) a LOCAL standalone Stellar network: stellar/quickstart --local with RPC.
# Never a public network. Needs a running Docker daemon.
set -euo pipefail
IMAGE="${QUICKSTART_IMAGE:-stellar/quickstart:latest}"
NAME="${QUICKSTART_NAME:-qwatt-local}"
PORT="${QUICKSTART_PORT:-8000}"
if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" -p "$PORT:8000" "$IMAGE" --local --enable rpc >/dev/null
fi
echo "waiting for RPC on localhost:$PORT ..."
for _ in $(seq 1 90); do
  if curl -s --noproxy localhost -m 3 -X POST -H 'Content-Type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "http://localhost:$PORT/rpc" | grep -q '"healthy"'; then
    curl -s --noproxy localhost -X POST -H 'Content-Type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"getNetwork"}' "http://localhost:$PORT/rpc"; echo
    exit 0
  fi
  sleep 4
done
echo "RPC did not become healthy" >&2; docker logs --tail 30 "$NAME" >&2; exit 1
