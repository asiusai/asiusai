import { and, eq, gte, lte, lt, desc } from 'drizzle-orm'
import { contract } from '../../connect/src/api/contract'
import { tsr } from '../common'
import { db } from '../db/client'
import { createDataSignature, deviceMiddleware } from '../middleware'
import { RouteData, routesTable } from '../db/schema'
import { Route, RouteSegment } from '../../connect/src/types'

const routeDataToRoute = (data: RouteData): Route => ({
  ...data,
  create_time: data.create_time.getTime(),
})

const routeDataToSegment = (data: RouteData): RouteSegment => {
  const startTime = data.start_time ? new Date(data.start_time).getTime() : data.create_time.getTime()
  const endTime = data.end_time ? new Date(data.end_time).getTime() : startTime
  const segmentCount = Math.max(1, Math.ceil(data.maxqlog) + 1)

  const segmentNumbers = Array.from({ length: segmentCount }, (_, i) => i)
  const segmentDuration = segmentCount > 1 ? (endTime - startTime) / segmentCount : 0
  const segmentStartTimes = segmentNumbers.map((i) => startTime + i * segmentDuration)
  const segmentEndTimes = segmentNumbers.map((i) => startTime + (i + 1) * segmentDuration)

  const exp = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const sig = createDataSignature(`${data.dongle_id}/${data.fullname.split('|')[1]}`, 'read_access', 24 * 60 * 60)

  return {
    ...data,
    create_time: data.create_time.getTime(),
    end_time_utc_millis: endTime,
    is_preserved: data.is_preserved,
    segment_end_times: segmentEndTimes,
    segment_numbers: segmentNumbers,
    segment_start_times: segmentStartTimes,
    share_exp: exp,
    share_sig: sig,
    start_time_utc_millis: startTime,
  }
}

export const routes = tsr.router(contract.routes, {
  allRoutes: deviceMiddleware(async ({ query }, { device }) => {
    const routes = await db.query.routesTable.findMany({
      where: and(eq(routesTable.dongle_id, device.dongle_id), query.created_before ? lt(routesTable.create_time, new Date(query.created_before)) : undefined),
      limit: query.limit,
      orderBy: desc(routesTable.create_time),
    })
    return { status: 200, body: routes.map(routeDataToRoute) }
  }),
  preserved: deviceMiddleware(async (_, { device }) => {
    const routes = await db.query.routesTable.findMany({
      where: and(eq(routesTable.dongle_id, device.dongle_id), eq(routesTable.is_preserved, true)),
      orderBy: desc(routesTable.create_time),
    })
    return { status: 200, body: routes.map(routeDataToRoute) }
  }),
  routesSegments: deviceMiddleware(async ({ query }, { device }) => {
    const conditions = [eq(routesTable.dongle_id, device.dongle_id)]

    if (query.route_str) conditions.push(eq(routesTable.fullname, query.route_str))
    if (query.start) conditions.push(gte(routesTable.create_time, new Date(query.start)))
    if (query.end) conditions.push(lte(routesTable.create_time, new Date(query.end)))

    const routes = await db.query.routesTable.findMany({
      where: and(...conditions),
      limit: query.limit,
      orderBy: desc(routesTable.create_time),
    })

    return { status: 200, body: routes.map(routeDataToSegment) }
  }),
})
