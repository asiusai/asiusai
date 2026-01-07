#!/bin/bash
# Fetch logs from the API server
# Usage: ./logs.sh [lines] [follow]
# Examples:
#   ./logs.sh          # Last 50 lines
#   ./logs.sh 100      # Last 100 lines
#   ./logs.sh -f       # Follow logs

LINES=${1:-50}
FOLLOW=""

if [[ "$1" == "-f" ]] || [[ "$2" == "-f" ]]; then
  FOLLOW="-f"
  [[ "$1" == "-f" ]] && LINES=50
fi

# Get server IP and SSH key from Pulumi
cd "$(dirname "$0")"
IP=$(dotenv pulumi stack export 2>/dev/null | grep -oE '"ipv4Address": "[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+"' | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+')

if [[ -z "$IP" ]]; then
  echo "Error: Could not get server IP from Pulumi"
  exit 1
fi

# Create temp file for SSH key
KEY_FILE=$(mktemp)
dotenv pulumi config get sshPrivateKey > "$KEY_FILE" 2>/dev/null
chmod 600 "$KEY_FILE"

# SSH and get logs
ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i "$KEY_FILE" "root@$IP" "docker logs asius-api --tail $LINES $FOLLOW" 2>/dev/null

# Cleanup
rm -f "$KEY_FILE"
