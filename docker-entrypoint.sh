#!/bin/bash
set -e

echo "Starting asius-api container..."
echo "PORT=$PORT"
echo "MKV_VOLUMES=${MKV_VOLUMES:-/tmp/mkv0,/tmp/mkv1}"

# Defaults
MKV_PORT=${MKV_PORT:-3000}
MKV_VOLUMES=${MKV_VOLUMES:-/tmp/mkv0,/tmp/mkv1}
MKV_DB=${MKV_DB:-/tmp/mkvdb}

# Check if volumes are mounted
for vol in $(echo $MKV_VOLUMES | tr ',' ' '); do
  echo "Checking volume: $vol"
  ls -la "$vol" 2>&1 | head -5 || echo "Volume $vol not accessible"
done

# Start MKV volume servers (one per mounted storage box)
i=0
VOLUME_HOSTS=""
for vol in $(echo $MKV_VOLUMES | tr ',' ' '); do
  VOL_PORT=$((MKV_PORT + 1 + i))
  echo "Starting volume server on port $VOL_PORT for $vol"
  PORT=$VOL_PORT ./minikeyvalue/volume "$vol/" &
  VOLUME_HOSTS="${VOLUME_HOSTS}localhost:${VOL_PORT},"
  i=$((i + 1))
done
VOLUME_HOSTS=${VOLUME_HOSTS%,}  # Remove trailing comma

echo "Starting MKV master on port $MKV_PORT with volumes: $VOLUME_HOSTS"
# Start MKV master
./minikeyvalue/src/mkv \
  -volumes "$VOLUME_HOSTS" \
  -db "$MKV_DB" \
  -replicas "$i" \
  --port "$MKV_PORT" \
  server &

# Wait for MKV to be ready
sleep 3
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
