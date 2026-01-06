import { $ } from 'bun'
import { existsSync } from 'fs'
import { env } from './env'

const url = (key: string) => `http://localhost:${env.MKV_PORT}/${key}`

export const mkv = {
  list: async (key: string, start?: string, limit?: string): Promise<string[]> => {
    let qs = 'list'
    if (start) qs += `&start=${start}`
    if (limit) qs += `&limit=${limit}`
    const res = await fetch(`${url(key)}?${qs}`)
    return res.ok ? await res.json() : []
  },

  get: async (key: string, headers?: HeadersInit): Promise<Response> => {
    return fetch(url(key), { headers, redirect: 'follow' })
  },

  put: async (key: string, body: ReadableStream<Uint8Array> | null, headers?: HeadersInit): Promise<Response> => {
    return fetch(url(key), {
      method: 'PUT',
      body,
      headers,
      // @ts-expect-error bun supports duplex
      duplex: 'half',
    })
  },

  delete: async (key: string): Promise<Response> => {
    return fetch(url(key), { method: 'DELETE' })
  },
}

export const startMkv = async () => {
  await $`mkdir -p ${env.MKV_VOLUMES.join(' ')} ${env.MKV_DB}`

  // Build mkv if needed
  if (!existsSync('../minikeyvalue/src/mkv')) await $`cd ../minikeyvalue/src && go build -o mkv`

  const volumes = env.MKV_VOLUMES.map((vol, i) => {
    const PORT = String(env.MKV_PORT + 1 + i)
    Bun.spawn(['../minikeyvalue/volume', `${vol}/`], { env: { ...process.env, PORT } })
    return `localhost:${PORT}`
  })

  Bun.spawn([
    '../minikeyvalue/src/mkv',
    '-volumes',
    volumes.join(','),
    '-db',
    env.MKV_DB,
    '-replicas',
    String(volumes.length),
    '--port',
    String(env.MKV_PORT),
    'server',
  ])

  console.log(`MKV started with ${volumes.length} volumes`)
}
