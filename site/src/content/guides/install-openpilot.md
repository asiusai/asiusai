---
title: Install Openpilot Fork
description: How to install the Asius openpilot fork on your comma device
order: 1
---

Install our openpilot fork on your comma device to unlock extra features like video streaming, joystick control, and more.

## Option 1: URL Install

On your comma device, enter the following URL in the installer:

```
https://openpilot.asius.ai
```

## Option 2: Git Clone

Or clone directly from GitHub:

```bash
git clone https://github.com/asiusai/openpilot
```

## After Installation

Once installed, you can access your device at:

1. [comma.asius.ai](https://comma.asius.ai) - if using Comma API (default)
2. [connect.asius.ai](https://connect.asius.ai) - if using Asius API (premium)


## CLI on existing device

echo -n "http://10.93.51.50:8080" > /data/params/d/APIHost
echo -n "ws://10.93.51.50:8080" > /data/params/d/AthenaHost
rm /data/params/d/DongleId 
./system/athena/registration.py # for testing
find /data/media/0/realdata -type f -exec setfattr -x user.upload {} + 2>/dev/null && echo "Done"
sudo reboot
