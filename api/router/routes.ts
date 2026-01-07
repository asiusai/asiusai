import { and, eq, lt, desc } from 'drizzle-orm'
import { contract } from '../../connect/src/api/contract'
import { tsr } from '../common'
import { db } from '../db/client'
import { createDataSignature, deviceMiddleware } from '../middleware'
import { segmentsTable, routeSettingsTable } from '../db/schema'
import { Route, RouteSegment } from '../../connect/src/types'

const aggregateRoute = async (dongleId: string, routeId: string, origin: string): Promise<(Route & { route_id: string; is_preserved: boolean }) | null> => {
  const segments = await db.query.segmentsTable.findMany({
    where: and(eq(segmentsTable.dongle_id, dongleId), eq(segmentsTable.route_id, routeId)),
    orderBy: segmentsTable.segment,
  })
  if (segments.length === 0) return null

  const settings = await db.query.routeSettingsTable.findFirst({
    where: and(eq(routeSettingsTable.dongle_id, dongleId), eq(routeSettingsTable.route_id, routeId)),
  })

  const firstSeg = segments[0]
  const lastSeg = segments[segments.length - 1]
  const maxSegment = Math.max(...segments.map((s) => s.segment))
  const make = firstSeg.platform?.split('_')[0]?.toLowerCase() ?? null

  const sig = createDataSignature(`${dongleId}/${routeId}`, 'read_access', 24 * 60 * 60)
  const routeName = encodeURIComponent(`${dongleId}|${routeId}`)

  return {
    route_id: routeId,
    dongle_id: dongleId,
    fullname: `${dongleId}|${routeId}`,
    create_time: firstSeg.create_time,
    start_time: firstSeg.start_time ? new Date(firstSeg.start_time).toISOString() : null,
    end_time: lastSeg.end_time ? new Date(lastSeg.end_time).toISOString() : null,
    start_lat: firstSeg.start_lat,
    start_lng: firstSeg.start_lng,
    end_lat: lastSeg.end_lat,
    end_lng: lastSeg.end_lng,
    distance: segments.reduce((sum, s) => sum + (s.distance ?? 0), 0) || null,
    version: firstSeg.version,
    git_branch: firstSeg.git_branch,
    git_commit: firstSeg.git_commit,
    git_commit_date: firstSeg.git_commit_date,
    git_dirty: firstSeg.git_dirty,
    git_remote: firstSeg.git_remote,
    platform: firstSeg.platform,
    vin: firstSeg.vin,
    maxqlog: maxSegment,
    procqlog: maxSegment,
    is_public: settings?.is_public ?? false,
    is_preserved: settings?.is_preserved ?? false,
    url: `${origin}/v1/route/${routeName}/derived/${sig}`,
    user_id: null,
    make,
    id: null,
    car_id: null,
    version_id: null,
  }
}

const routeToSegment = (route: Route & { route_id: string; is_preserved: boolean }): RouteSegment => {
  const startTime = route.start_time ? new Date(route.start_time).getTime() : route.create_time
  const endTime = route.end_time ? new Date(route.end_time).getTime() : startTime
  const segmentCount = Math.max(1, route.maxqlog + 1)

  const segmentNumbers = Array.from({ length: segmentCount }, (_, i) => i)
  const segmentDuration = segmentCount > 1 ? (endTime - startTime) / segmentCount : 0
  const segmentStartTimes = segmentNumbers.map((i) => startTime + i * segmentDuration)
  const segmentEndTimes = segmentNumbers.map((i) => startTime + (i + 1) * segmentDuration)

  const exp = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const sig = createDataSignature(`${route.dongle_id}/${route.route_id}`, 'read_access', 24 * 60 * 60)

  return {
    create_time: route.create_time,
    dongle_id: route.dongle_id,
    end_lat: route.end_lat,
    end_lng: route.end_lng,
    end_time: route.end_time,
    fullname: route.fullname,
    git_branch: route.git_branch,
    git_commit: route.git_commit,
    git_commit_date: route.git_commit_date,
    git_dirty: route.git_dirty,
    git_remote: route.git_remote,
    is_public: route.is_public,
    distance: route.distance,
    maxqlog: route.maxqlog,
    platform: route.platform,
    procqlog: route.procqlog,
    start_lat: route.start_lat,
    start_lng: route.start_lng,
    start_time: route.start_time,
    url: route.url,
    user_id: route.user_id,
    version: route.version,
    vin: route.vin,
    make: route.make,
    id: route.id,
    car_id: route.car_id,
    version_id: route.version_id,
    end_time_utc_millis: endTime,
    is_preserved: route.is_preserved,
    segment_end_times: segmentEndTimes,
    segment_numbers: segmentNumbers,
    segment_start_times: segmentStartTimes,
    share_exp: exp,
    share_sig: sig,
    start_time_utc_millis: startTime,
  }
}

type AggregatedRoute = Route & { route_id: string; is_preserved: boolean }

const getDistinctRoutes = async (dongleId: string, origin: string, options?: { limit?: number; createdBefore?: number; preservedOnly?: boolean }) => {
  const conditions = [eq(segmentsTable.dongle_id, dongleId)]
  if (options?.createdBefore) conditions.push(lt(segmentsTable.create_time, options.createdBefore))

  const routeIds = await db
    .selectDistinct({ route_id: segmentsTable.route_id })
    .from(segmentsTable)
    .where(and(...conditions))
    .orderBy(desc(segmentsTable.create_time))
    .limit(options?.limit ?? 100)

  const routes: AggregatedRoute[] = []
  for (const { route_id } of routeIds) {
    const route = await aggregateRoute(dongleId, route_id, origin)
    if (route) {
      if (options?.preservedOnly && !route.is_preserved) continue
      routes.push(route)
    }
  }
  return routes
}

export const routes = tsr.router(contract.routes, {
  allRoutes: deviceMiddleware(async ({ query }, { device, origin }) => {
    const routes = await getDistinctRoutes(device.dongle_id, origin, {
      limit: query.limit,
      createdBefore: query.created_before,
    })
    return { status: 200, body: routes }
  }),
  preserved: deviceMiddleware(async (_, { device, origin }) => {
    const routes = await getDistinctRoutes(device.dongle_id, origin, { preservedOnly: true })
    return { status: 200, body: routes }
  }),
  routesSegments: deviceMiddleware(async ({ query }, { device, origin }) => {
    let routes: AggregatedRoute[]

    if (query.route_str) {
      const [dongleId, routeId] = query.route_str.split('|')
      if (dongleId !== device.dongle_id) {
        return { status: 200, body: [] }
      }
      const route = await aggregateRoute(dongleId, routeId, origin)
      routes = route ? [route] : []
    } else {
      routes = await getDistinctRoutes(device.dongle_id, origin, { limit: query.limit })

      if (query.start || query.end) {
        routes = routes.filter((r) => {
          if (query.start && r.create_time < query.start) return false
          if (query.end && r.create_time > query.end) return false
          return true
        })
      }
    }

    return { status: 200, body: routes.map(routeToSegment) }
  }),
})
