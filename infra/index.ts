import * as cloudflare from '@pulumi/cloudflare'
import * as pulumi from '@pulumi/pulumi'
import { Site } from './Site'
import { Worker } from './Worker'
import { Server } from './Server'

const config = new pulumi.Config()

// ------------------------- CONSTS -------------------------
const accountId = '558df022e422781a34f239d7de72c8ae'
const zoneId = 'f4c49c38916764f43e3854fb5461db31'

// ------------------------- BUCKETS -------------------------
const dbBackupBucket = new cloudflare.R2Bucket('db-backup-bucket', {
  accountId,
  name: 'asius-db-backup',
})

// ------------------------- PROXIES -------------------------
new Worker('api-konik-proxy', {
  accountId,
  zoneId,
  domain: 'api-konik-proxy.asius.ai',
  file: './workers/cors-proxy.js',
  env: { ORIGIN: 'api.konik.ai' },
})
new Worker('athena-comma-proxy', {
  accountId,
  zoneId,
  domain: 'athena-comma-proxy.asius.ai',
  file: './workers/cors-proxy.js',
  env: { ORIGIN: 'athena.comma.ai' },
})
new Worker('billing-comma-proxy', {
  accountId,
  zoneId,
  domain: 'billing-comma-proxy.asius.ai',
  file: './workers/cors-proxy.js',
  env: { ORIGIN: 'billing.comma.ai' },
})

// ------------------------- INSTALLERS -------------------------
new Worker('openpilot-installer', {
  accountId,
  zoneId,
  domain: 'openpilot.asius.ai',
  file: './workers/installer.js',
})
new Worker('sunnypilot-installer', {
  accountId,
  zoneId,
  domain: 'sunnypilot.asius.ai',
  file: './workers/installer.js',
})

// ------------------------- SITES -------------------------
new Site('comma-connect', {
  accountId,
  zoneId,
  rootDir: 'connect',
  buildCommand: 'bun i && bun run --bun vite build --mode comma',
  domain: 'comma.asius.ai',
})
new Site('konik-connect', {
  accountId,
  zoneId,
  rootDir: 'connect',
  buildCommand: 'bun i && bun run --bun vite build --mode konik',
  domain: 'konik.asius.ai',
})
new Site('asius-connect', {
  accountId,
  zoneId,
  rootDir: 'connect',
  buildCommand: 'bun i && bun run --bun vite build --mode asius',
  domain: 'connect.asius.ai',
})
new Site('asius-site', {
  accountId,
  zoneId,
  rootDir: 'site',
  buildCommand: 'bun i && bun run build',
  domain: 'asius.ai',
})

// ------------------------- SERVERS -------------------------
const sshPublicKey = config.requireSecret('sshPublicKey')
const sshPrivateKey = config.requireSecret('sshPrivateKey')

// ------------------------- API SERVER -------------------------
const R2_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID!
const R2_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY!

new Server('api', {
  allowedPorts: ['22', '80'],
  sshPublicKey,
  zoneId,
  serverType: 'cpx32',
  domain: 'api.asius.ai',
  sshPrivateKey,
  proxied: true,
  services: [
    {
      name: 'asius-sshfs',
      service: {
        Unit: {
          Description: 'Mount storage boxes via SSHFS',
          After: 'network-online.target',
          Wants: 'network-online.target',
        },
        Service: {
          Type: 'oneshot',
          RemainAfterExit: 'yes',
          ExecStartPre: ["/bin/bash -c 'fusermount -u /data/mkv1 2>/dev/null || true'", "/bin/bash -c 'fusermount -u /data/mkv2 2>/dev/null || true'"],
          ExecStart: [
            '/usr/bin/sshfs -o IdentityFile=/root/.ssh/storagebox_key,port=23,allow_other,reconnect,ServerAliveInterval=15,ServerAliveCountMax=3 u526268@u526268.your-storagebox.de: /data/mkv1',
            '/usr/bin/sshfs -o IdentityFile=/root/.ssh/storagebox_key,port=23,allow_other,reconnect,ServerAliveInterval=15,ServerAliveCountMax=3 u526270@u526270.your-storagebox.de: /data/mkv2',
          ],
          ExecStop: ['/bin/fusermount -u /data/mkv1', '/bin/fusermount -u /data/mkv2'],
        },
        Install: {
          WantedBy: 'multi-user.target',
        },
      },
    },
    ...[1, 2].map((i) => ({
      name: `asius-mkv${i}`,
      service: {
        Unit: {
          Description: `MiniKeyValue Volume ${i}`,
          After: 'network.target asius-sshfs.service',
          Requires: 'asius-sshfs.service',
        },
        Service: {
          Type: 'simple',
          WorkingDirectory: '/app',
          Environment: {
            PORT: `300${i}`,
            MKV_TMP: `/tmp/mkv${i}_tmp`,
            MKV_BODY: `/tmp/mkv${i}_body`,
          },
          ExecStartPre: `/bin/mkdir -p /tmp/mkv${i}_tmp /tmp/mkv${i}_body`,
          ExecStart: `/app/minikeyvalue/volume /data/mkv${i}/`,
          Restart: 'always',
        },
        Install: {
          WantedBy: 'multi-user.target',
        },
      },
    })),
    {
      name: 'asius-mkv',
      service: {
        Unit: {
          Description: 'MiniKeyValue Master',
          After: 'asius-mkv1.service asius-mkv2.service',
          Requires: 'asius-mkv1.service asius-mkv2.service',
        },
        Service: {
          Type: 'simple',
          WorkingDirectory: '/app',
          ExecStartPre: "/bin/bash -c 'until curl -sf http://localhost:3001/ && curl -sf http://localhost:3002/; do sleep 0.5; done'",
          ExecStart: '/app/minikeyvalue/src/mkv -volumes localhost:3001,localhost:3002 -db /data/mkvdb -replicas 1 --port 3000 server',
          Restart: 'always',
        },
        Install: {
          WantedBy: 'multi-user.target',
        },
      },
    },
    {
      name: 'asius-api',
      service: {
        Unit: {
          Description: 'Asius API',
          After: 'network.target asius-mkv.service',
          Requires: 'asius-mkv.service',
        },
        Service: {
          Type: 'simple',
          WorkingDirectory: '/app/api',
          ExecStartPre: "/bin/bash -c 'until nc -z localhost 3000; do sleep 0.5; done'",
          ExecStart: 'bun run index.ts',
          Restart: 'always',
          Environment: {
            PORT: '80',
            MKV_URL: 'http://localhost:3000',
            DB_PATH: '/data/db/data.db',
            JWT_SECRET: config.requireSecret('jwtSecret'),
            GOOGLE_CLIENT_ID: config.requireSecret('googleClientId'),
            GOOGLE_CLIENT_SECRET: config.requireSecret('googleClientSecret'),
            API_ORIGIN: 'wss://api.asius.ai',
            SSH_API_KEY: config.requireSecret('sshApiKey'),
            R2_BUCKET: dbBackupBucket.name,
            R2_ACCOUNT_ID: accountId,
            R2_ACCESS_KEY_ID,
            R2_SECRET_ACCESS_KEY,
          },
        },
        Install: {
          WantedBy: 'multi-user.target',
        },
      },
    },
  ],
  createScript: pulumi.interpolate`
set -e
apt-get update && apt-get install -y sshfs golang-go curl git unzip nginx

# Install bun
curl -fsSL https://bun.sh/install | bash
ln -sf /root/.bun/bin/bun /usr/local/bin/bun

# Create data directories
mkdir -p /data/mkv1 /data/mkv2 /data/mkvdb /data/db /app

# Setup SSH key for storage boxes
mkdir -p /root/.ssh
echo '${sshPrivateKey}' > /root/.ssh/storagebox_key
chmod 600 /root/.ssh/storagebox_key
ssh-keyscan -p 23 u526268.your-storagebox.de >> /root/.ssh/known_hosts 2>/dev/null || true
ssh-keyscan -p 23 u526270.your-storagebox.de >> /root/.ssh/known_hosts 2>/dev/null || true

# Disable nginx (only used by MKV volume)
systemctl stop nginx
systemctl disable nginx
`,
  deployScript: `cd /app/minikeyvalue/src && go build -o mkv && cd /app/api && bun install`,
})

// ------------------------- SSH SERVER -------------------------
// new Server('ssh', {
//   allowedPorts: ['22', '2222', '80', '443'],
//   serverType: 'cpx22',
//   sshPrivateKey,
//   sshPublicKey,
//   zoneId,
//   domain: 'api.asius.ai',
//   proxied: false,
//   services: [
//     {
//       name: 'ssh',
//       service: {
//         Unit: {
//           Description: 'Asius SSH Proxy',
//           After: 'network.target',
//         },
//         Service: {
//           Type: 'simple',
//           WorkingDirectory: '/app/ssh',
//           ExecStart: '/app/ssh/start.sh',
//           Restart: 'always',
//           Environment: {
//             SSH_PORT: '2222',
//             WS_PORT: '8080',
//             API_KEY: config.requireSecret('sshApiKey'),
//             WS_ORIGIN: 'wss://ssh.asius.ai',
//           },
//           Install: {
//             WantedBy: 'multi-user.target',
//           },
//         },
//       },
//     },
//   ],
//   createScript: pulumi.interpolate`set -e
// # Install dependencies
// apt-get update && apt-get install -y curl git unzip

// # Install bun
// curl -fsSL https://bun.sh/install | bash
// export PATH="/root/.bun/bin:$PATH"

// # Install Caddy
// apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
// curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
// curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
// apt-get update && apt-get install -y caddy

// # Clone repo if not exists
// if [ ! -d /app ]; then
//   git clone https://github.com/asiusai/asiusai.git /app
// fi
// `,
//   deployScript: `set -e
// export PATH="/root/.bun/bin:$PATH"

// cd /app

// # Fetch and checkout the deployed commit
// git fetch origin deploy-ssh
// git checkout FETCH_HEAD --force

// # Install dependencies
// cd ssh && bun install
// cd /app

// # Restart service
// systemctl restart asius-ssh
// `,
// })
