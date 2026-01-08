---
title: SSH Remote Access
description: How to SSH into your comma device remotely via the Asius API
order: 4
---

With an Asius subscription, you can SSH into your comma device from anywhere using our WebSocket relay.

## Prerequisites

- Device paired with your Asius account
- Device online (connected to athena)
- SSH enabled on your device with your GitHub SSH keys configured
- `websocat` installed ([github.com/vi/websocat](https://github.com/vi/websocat))
- Your Asius API token

## Quick Start

### 1. Install websocat

```bash
# macOS
brew install websocat

# Linux (download binary)
curl -L https://github.com/vi/websocat/releases/latest/download/websocat.x86_64-unknown-linux-musl -o websocat
chmod +x websocat
sudo mv websocat /usr/local/bin/
```

### 2. Get Your API Token

Get your JWT token from [connect.asius.ai](https://connect.asius.ai) (Settings > API Token).

### 3. Create SSH Proxy Script

Create a file called `asius-ssh-proxy` and make it executable:

```bash
#!/bin/bash
# asius-ssh-proxy - SSH proxy for Asius devices
# Usage: asius-ssh-proxy <dongle_id>

DONGLE_ID="$1"
API_URL="${ASIUS_API_URL:-https://api.asius.ai}"
TOKEN="${ASIUS_TOKEN}"

if [ -z "$DONGLE_ID" ]; then
  echo "Usage: asius-ssh-proxy <dongle_id>" >&2
  exit 1
fi

if [ -z "$TOKEN" ]; then
  echo "Error: ASIUS_TOKEN environment variable not set" >&2
  exit 1
fi

# Create SSH session
RESPONSE=$(curl -s -X POST "$API_URL/v1/devices/$DONGLE_ID/ssh" \
  -H "Authorization: JWT $TOKEN")

WS_URL=$(echo "$RESPONSE" | grep -o '"wsUrl":"[^"]*"' | cut -d'"' -f4)

if [ -z "$WS_URL" ]; then
  echo "Error: Failed to create SSH session: $RESPONSE" >&2
  exit 1
fi

# Connect to WebSocket relay
exec websocat -b "$WS_URL" --header "Authorization: JWT $TOKEN"
```

```bash
chmod +x asius-ssh-proxy
sudo mv asius-ssh-proxy /usr/local/bin/
```

### 4. Configure SSH

Add this to your `~/.ssh/config`:

```
Host asius-*
  User comma
  IdentityFile ~/.ssh/id_ed25519
  ProxyCommand asius-ssh-proxy %n
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
```

### 5. Set Environment Variable

Add to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.):

```bash
export ASIUS_TOKEN="your-jwt-token-here"
```

### 6. Connect

Replace `ffffffffffffffff` with your dongle ID:

```bash
ssh asius-ffffffffffffffff
```

## One-off Connection

For a quick one-off connection without the SSH config:

```bash
export ASIUS_TOKEN="your-jwt-token"
ssh -o ProxyCommand="asius-ssh-proxy ffffffffffffffff" comma@localhost
```

## Troubleshooting

### Device Offline

If you get "Device offline", make sure your device is:
- Powered on
- Connected to the internet
- Running openpilot/sunnypilot with athena enabled

### Connection Timeout

The SSH session has a 30-second window for the device to connect. If your device has slow connectivity, try again.

### Permission Denied

Make sure:
- Your GitHub SSH keys are configured on the device
- You're using the correct SSH key (`-i ~/.ssh/your_key`)
- SSH is enabled on the device

## How It Works

1. Your SSH client calls the proxy script
2. The script requests an SSH session from the Asius API
3. The API tells your device to connect to a WebSocket relay
4. Your SSH traffic is relayed through the WebSocket to your device
5. The device proxies the traffic to its local SSH server (port 22)

This approach works through firewalls and NAT without requiring port forwarding.
