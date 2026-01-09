#!/bin/bash
set -e

# Start Caddy in background
caddy start --config /app/Caddyfile &

# Start the SSH/WS server
exec bun run index.ts
