import { readdir, readFile } from 'fs/promises'
import { join, dirname } from 'path'
import jwt from 'jsonwebtoken'
import { generateKeyPairSync } from 'crypto'

const EXAMPLE_DATA_DIR = join(dirname(import.meta.path), '../../example-data')
const ROUTE_PREFIX = '9748a98e983e0b39_'
const ROUTE_ID = '0000002c--d68dde99ca'

const TARGETS = {
  local: { api: 'http://localhost:8080', connect: 'http://localhost:4000' },
  konik: { api: 'https://api.konik.ai', connect: 'http://localhost:4002' },
  asius: { api: 'https://api.asius.ai', connect: 'https://asius.ai' },
}

type Target = keyof typeof TARGETS

const target = (process.argv[2] as Target) || 'local'
if (!TARGETS[target]) {
  console.error(`Unknown target: ${target}. Use: local, konik, asius`)
  process.exit(1)
}

const { api: API_URL, connect: CONNECT_URL } = TARGETS[target]

// Types
type RouteMetadata = {
  version: string
  git_branch: string
  git_commit: string
  git_commit_date: string
  git_dirty: boolean
  git_remote: string
  platform: string
  vin: string
  make: string
  start_lat: number
  start_lng: number
  end_lat: number
  end_lng: number
  distance: number
  maxqlog: number
}

type RouteEvent = { type: string; route_offset_millis: number; route_offset_nanos: number; data: unknown }
type Coord = { lat: number; lng: number; speed: number; bearing: number; t: number; dist: number }

// Comparison functions
// Konik API differences:
// Route metadata:
// - version, git_dirty are null (not extracted from qlog)
// - git_commit_date format differs (undefined vs ISO string)
// - vin is empty string instead of actual value
// - make is undefined (not derived from platform)
// Derived files:
// - events.json: Konik logs all state changes (~500/segment), we only log significant events (~5/segment)
// - coords.json: Konik uses cumulative distance in meters, we use small decimals. Different precision.
const compareRoute = (actual: Record<string, unknown>, expected: RouteMetadata) => {
  const errors: string[] = []

  // These fields may be null/undefined on Konik
  if (target === 'local') {
    if (actual.version !== expected.version) errors.push(`version: got "${actual.version}", expected "${expected.version}"`)
    if (actual.git_dirty !== expected.git_dirty) errors.push(`git_dirty: got ${actual.git_dirty}, expected ${expected.git_dirty}`)
    if (actual.git_commit_date !== expected.git_commit_date) errors.push(`git_commit_date: got "${actual.git_commit_date}", expected "${expected.git_commit_date}"`)
    if (actual.vin !== expected.vin) errors.push(`vin: got "${actual.vin}", expected "${expected.vin}"`)
    const expectedMake = expected.platform?.split('_')[0]?.toLowerCase()
    if (actual.make !== expectedMake) errors.push(`make: got "${actual.make}", expected "${expectedMake}"`)
  }

  // These should work on both
  if (actual.git_branch !== expected.git_branch) errors.push(`git_branch: got "${actual.git_branch}", expected "${expected.git_branch}"`)
  if (actual.git_commit !== expected.git_commit) errors.push(`git_commit: got "${actual.git_commit}", expected "${expected.git_commit}"`)
  if (actual.git_remote?.toString().replace('https://', '') !== expected.git_remote) errors.push(`git_remote: got "${actual.git_remote}", expected "${expected.git_remote}"`)
  if (actual.platform !== expected.platform) errors.push(`platform: got "${actual.platform}", expected "${expected.platform}"`)

  const precision = 0.01
  if (Math.abs((actual.start_lat as number) - expected.start_lat) > precision) errors.push(`start_lat: got ${actual.start_lat}, expected ${expected.start_lat}`)
  if (Math.abs((actual.start_lng as number) - expected.start_lng) > precision) errors.push(`start_lng: got ${actual.start_lng}, expected ${expected.start_lng}`)
  if (Math.abs((actual.end_lat as number) - expected.end_lat) > precision) errors.push(`end_lat: got ${actual.end_lat}, expected ${expected.end_lat}`)
  if (Math.abs((actual.end_lng as number) - expected.end_lng) > precision) errors.push(`end_lng: got ${actual.end_lng}, expected ${expected.end_lng}`)

  if (actual.maxqlog !== expected.maxqlog) errors.push(`maxqlog: got ${actual.maxqlog}, expected ${expected.maxqlog}`)

  const distRatio = (actual.distance as number) / expected.distance
  if (distRatio < 0.5 || distRatio > 2) errors.push(`distance: got ${actual.distance}, expected ${expected.distance}`)

  return { pass: errors.length === 0, errors }
}

const compareEvents = (actual: RouteEvent[], expected: RouteEvent[]) => {
  const errors: string[] = []
  if (actual.length !== expected.length) errors.push(`Count mismatch: got ${actual.length}, expected ${expected.length}`)
  for (let i = 0; i < Math.min(actual.length, expected.length); i++) {
    if (actual[i].type !== expected[i].type) errors.push(`Event ${i} type: got "${actual[i].type}", expected "${expected[i].type}"`)
    if (JSON.stringify(actual[i].data) !== JSON.stringify(expected[i].data)) errors.push(`Event ${i} data mismatch`)
  }
  return { pass: errors.length === 0, errors }
}

const compareCoords = (actual: Coord[], expected: Coord[]) => {
  const errors: string[] = []
  if (Math.abs(actual.length - expected.length) > 2) errors.push(`Count mismatch: got ${actual.length}, expected ${expected.length}`)
  for (let i = 0; i < Math.min(actual.length, expected.length); i++) {
    if (Math.abs(actual[i].lat - expected[i].lat) > 0.0001) errors.push(`Coord ${i} lat: got ${actual[i].lat}, expected ${expected[i].lat}`)
    if (Math.abs(actual[i].lng - expected[i].lng) > 0.0001) errors.push(`Coord ${i} lng: got ${actual[i].lng}, expected ${expected[i].lng}`)
  }
  return { pass: errors.length === 0, errors }
}

const compareSprite = (actual: Uint8Array, expected: Uint8Array) => {
  const errors: string[] = []
  if (actual[0] !== 0xff || actual[1] !== 0xd8) errors.push('Not a valid JPEG (missing FFD8 header)')
  const sizeDiff = Math.abs(actual.length - expected.length) / expected.length
  if (sizeDiff > 0.1) errors.push(`Size differs by ${(sizeDiff * 100).toFixed(1)}% (got ${actual.length}, expected ${expected.length})`)
  return { pass: errors.length === 0, errors }
}

// API helpers
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
})

const jwtAlgorithm = 'RS256' as const

const register = async () => {
  const params = new URLSearchParams({
    imei: `test-${Date.now()}`,
    imei2: `test2-${Date.now()}`,
    serial: `serial-${Date.now()}`,
    public_key: publicKey,
    register_token: jwt.sign({ register: true }, privateKey, { algorithm: jwtAlgorithm, expiresIn: '1h' }),
  })

  const res = await fetch(`${API_URL}/v2/pilotauth/?${params}`, { method: 'POST' })
  if (!res.ok) throw new Error(`Register failed: ${await res.text()}`)

  const data = await res.json()
  return data.dongle_id as string
}

type UploadInfo = { url: string; headers?: Record<string, string> }

const getUploadInfo = async (dongleId: string, path: string, token: string): Promise<UploadInfo> => {
  const res = await fetch(`${API_URL}/v1.4/${dongleId}/upload_url/?path=${encodeURIComponent(path)}`, {
    headers: { Authorization: `JWT ${token}` },
  })
  if (!res.ok) throw new Error(`Get upload URL failed: ${await res.text()}`)
  const data = await res.json()
  return { url: data.url, headers: data.headers }
}

const uploadFile = async (info: UploadInfo, filePath: string) => {
  const content = await readFile(filePath)
  const res = await fetch(info.url, {
    method: 'PUT',
    body: content,
    headers: info.headers ?? { 'Content-Type': 'application/octet-stream' },
  })
  if (!res.ok && res.status !== 403) throw new Error(`Upload failed: ${res.status} ${await res.text()}`)
}

const fetchUrl = async (url: string) => {
  const res = await fetch(url)
  return res.ok ? res.arrayBuffer() : null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Main test flow
const main = async () => {
  console.log(`Testing device flow on ${target} (${API_URL})\n`)

  // Register device
  const dongleId = await register()
  console.log(`Registered: ${dongleId}`)

  const deviceToken = jwt.sign({ identity: dongleId, nbf: Math.floor(Date.now() / 1000) }, privateKey, { algorithm: jwtAlgorithm, expiresIn: '1h' })

  // Find and upload files
  const files = await readdir(EXAMPLE_DATA_DIR)
  const uploadFiles = files.filter((f) => f.endsWith('qlog.zst') || f.endsWith('qcamera.ts'))

  console.log(`\nUploading ${uploadFiles.length} files...`)
  for (const file of uploadFiles) {
    const match = file.match(/^[^_]+_([^-]+--.+)--(\d+)--(.+)$/)
    if (!match) continue

    const [, routeId, segment, filename] = match
    const path = `${routeId}--${segment}/${filename}`
    const uploadUrl = await getUploadInfo(dongleId, path, deviceToken)
    await uploadFile(uploadUrl, join(EXAMPLE_DATA_DIR, file))
    console.log(`  ${path}`)
  }

  // Wait for processing
  console.log('\nWaiting 10s for processing...')
  await sleep(10000)

  let allPass = true

  // Verify route metadata
  console.log('\nVerifying route metadata...')
  const routeRes = await fetch(`${API_URL}/v1/route/${dongleId}%7C${ROUTE_ID}/`, {
    headers: { Authorization: `JWT ${deviceToken}` },
  })
  const actualRoute = (await routeRes.json()) as Record<string, unknown>
  const expectedRoute = JSON.parse(await readFile(join(EXAMPLE_DATA_DIR, `${ROUTE_PREFIX}${ROUTE_ID}.json`), 'utf-8')) as RouteMetadata

  const routeResult = compareRoute(actualRoute, expectedRoute)
  if (routeResult.pass) {
    console.log('  route: PASS')
  } else {
    console.log('  route: FAIL')
    routeResult.errors.forEach((e) => console.log(`    - ${e}`))
    allPass = false
  }

  // Verify derived files using route.url
  console.log('\nVerifying derived files...')
  const routeUrl = actualRoute.url as string
  if (!routeUrl) {
    console.log('  FAIL: route.url not found')
    allPass = false
  } else {
    const segments = new Set<string>()
    for (const file of uploadFiles) {
      const match = file.match(/^[^_]+_([^-]+--.+)--(\d+)--/)
      if (match) segments.add(match[2])
    }

    for (const segment of segments) {
      const prefix = `${ROUTE_PREFIX}${ROUTE_ID}--${segment}`
      console.log(`\n  segment ${segment}:`)

      const baseUrl = routeUrl.replace(/\/$/, '')
      const [eventsData, coordsData, spriteData] = await Promise.all([
        fetchUrl(`${baseUrl}/${segment}/events.json`),
        fetchUrl(`${baseUrl}/${segment}/coords.json`),
        fetchUrl(`${baseUrl}/${segment}/sprite.jpg`),
      ])
      const expectedEvents = JSON.parse(await readFile(join(EXAMPLE_DATA_DIR, `${prefix}--events.json`), 'utf-8')) as RouteEvent[]
      const expectedCoords = JSON.parse(await readFile(join(EXAMPLE_DATA_DIR, `${prefix}--coords.json`), 'utf-8')) as Coord[]
      const expectedSprite = new Uint8Array(await readFile(join(EXAMPLE_DATA_DIR, `${prefix}--sprite.jpg`)))

      // Events - Konik has different event extraction logic
      if (!eventsData) {
        console.log('    events: FAIL (not found)')
        allPass = false
      } else if (target === 'konik') {
        const events = JSON.parse(new TextDecoder().decode(eventsData)) as RouteEvent[]
        console.log(`    events: SKIP (${events.length} events, Konik uses different format)`)
        if (events.length > 0) console.log(`      sample: ${JSON.stringify(events[0])}`)
      } else {
        const result = compareEvents(JSON.parse(new TextDecoder().decode(eventsData)), expectedEvents)
        console.log(result.pass ? '    events: PASS' : '    events: FAIL')
        if (!result.pass) { result.errors.forEach((e) => console.log(`      - ${e}`)); allPass = false }
      }

      // Coords - Konik has slight precision differences
      if (!coordsData) {
        console.log('    coords: FAIL (not found)')
        allPass = false
      } else if (target === 'konik') {
        const coords = JSON.parse(new TextDecoder().decode(coordsData)) as Coord[]
        console.log(`    coords: SKIP (${coords.length} coords, Konik uses different precision)`)
        if (coords.length > 0) console.log(`      sample: ${JSON.stringify(coords[0])}`)
      } else {
        const result = compareCoords(JSON.parse(new TextDecoder().decode(coordsData)), expectedCoords)
        console.log(result.pass ? '    coords: PASS' : '    coords: FAIL')
        if (!result.pass) { result.errors.forEach((e) => console.log(`      - ${e}`)); allPass = false }
      }

      // Sprite
      if (!spriteData) {
        console.log('    sprite: FAIL (not found)')
        allPass = false
      } else {
        const result = compareSprite(new Uint8Array(spriteData), expectedSprite)
        console.log(result.pass ? '    sprite: PASS' : '    sprite: FAIL')
        if (!result.pass) { result.errors.forEach((e) => console.log(`      - ${e}`)); allPass = false }
      }
    }
  }

  // Pairing URL
  const pairToken = jwt.sign({ identity: dongleId, pair: true }, privateKey, { algorithm: jwtAlgorithm, expiresIn: '1h' })
  console.log(`\n${'='.repeat(50)}`)
  console.log(`Pairing URL: ${CONNECT_URL}/pair?pair=${pairToken}`)
  console.log(`Device ID: ${dongleId}`)
  console.log(`${'='.repeat(50)}`)

  if (allPass) {
    console.log('\nAll tests passed!')
  } else {
    console.log('\nSome tests failed.')
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
