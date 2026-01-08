#!/bin/bash
set -e

echo "Starting asius-api container..."
echo "PORT=$PORT"

# Defaults
MKV_PORT=${MKV_PORT:-3000}
MKV_DB=${MKV_DB:-/tmp/mkvdb}
MKV_DATA1=${MKV_DATA1:-/data/mkv1}
MKV_DATA2=${MKV_DATA2:-/data/mkv2}

# Setup MKV volumes - use local temp dirs for nginx (avoids SSHFS permission issues)
mkdir -p /tmp/mkv1_tmp /tmp/mkv1_body /tmp/mkv2_tmp /tmp/mkv2_body
export MKV_TMP1=/tmp/mkv1_tmp
export MKV_BODY1=/tmp/mkv1_body
export MKV_TMP2=/tmp/mkv2_tmp
export MKV_BODY2=/tmp/mkv2_body

echo "Starting volume server on port 3001 for $MKV_DATA1"
PORT=3001 MKV_TMP=$MKV_TMP1 MKV_BODY=$MKV_BODY1 ./minikeyvalue/volume "$MKV_DATA1/" &

echo "Starting volume server on port 3002 for $MKV_DATA2"
PORT=3002 MKV_TMP=$MKV_TMP2 MKV_BODY=$MKV_BODY2 ./minikeyvalue/volume "$MKV_DATA2/" &

# Wait for volume servers to start
sleep 2
curl -s -o /dev/null -w "Volume server on port 3001: %{http_code}\n" "http://localhost:3001/" || echo "Volume server 1 not responding"
curl -s -o /dev/null -w "Volume server on port 3002: %{http_code}\n" "http://localhost:3002/" || echo "Volume server 2 not responding"

echo "Starting MKV master on port $MKV_PORT with 2 volumes"
./minikeyvalue/src/mkv \
  -volumes "localhost:3001,localhost:3002" \
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
