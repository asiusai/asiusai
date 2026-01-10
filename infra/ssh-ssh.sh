#!/bin/bash
# SSH into the SSH proxy server
# Usage: ./ssh-ssh.sh [command]

cd "$(dirname "$0")"
# Extract SSH server IP specifically (not the API server)
IP=$(dotenv pulumi stack export 2>/dev/null | grep -A10 '"type": "hcloud:index/server:Server"' | grep -A10 '"name": "ssh-server"' | grep -oE '"ipv4Address": "[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+"' | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+')

if [[ -z "$IP" ]]; then
  echo "Error: Could not get server IP from Pulumi"
  exit 1
fi

KEY_FILE=$(mktemp)
dotenv pulumi config get sshPrivateKey > "$KEY_FILE" 2>/dev/null
chmod 600 "$KEY_FILE"

if [[ -n "$1" ]]; then
  ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i "$KEY_FILE" "root@$IP" "$@" 2>/dev/null
else
  ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i "$KEY_FILE" "root@$IP" 2>/dev/null
fi

rm -f "$KEY_FILE"
