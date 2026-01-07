#!/bin/bash
set -e

echo "Starting asius-api container..."
echo "PORT=$PORT"

# Defaults
MKV_PORT=${MKV_PORT:-3000}
MKV_DB=${MKV_DB:-/tmp/mkvdb}
MKV_DATA=${MKV_DATA:-/data/mkv}

# Setup local MKV volume
mkdir -p "$MKV_DATA/tmp" "$MKV_DATA/body_temp"
echo "Starting volume server on port 3001 for $MKV_DATA"
PORT=3001 ./minikeyvalue/volume "$MKV_DATA/" &

# Wait for volume server to start
sleep 2
curl -s -o /dev/null -w "Volume server on port 3001: %{http_code}\n" "http://localhost:3001/" || echo "Volume server not responding"

echo "Starting MKV master on port $MKV_PORT"
./minikeyvalue/src/mkv \
  -volumes "localhost:3001" \
  -db "$MKV_DB" \
  -replicas 1 \
  --port "$MKV_PORT" \
  server &

# Wait for MKV to be ready
sleep 2
echo "MKV started, testing..."
curl -s "http://localhost:${MKV_PORT}/" || echo "MKV not responding"

# Export MKV_URL for the API
export MKV_URL="http://localhost:${MKV_PORT}"

# Run database migrations
cd api
echo "Running database migrations..."
bun run db:push

echo "Starting API on port $PORT..."
# Start API
exec bun run index.ts
