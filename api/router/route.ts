import { eq } from 'drizzle-orm'
import { contract } from '../../connect/src/api/contract'
import { ForbiddenError, InternalServerError, tsr } from '../common'
import { db } from '../db/client'
import { routesTable, RouteData } from '../db/schema'
import { createDataSignature, createRouteSignature, routeMiddleware } from '../middleware'
import { Route, Files } from '../../connect/src/types'
import { mkv } from '../mkv'

const routeDataToRoute = (data: RouteData): Route => ({
  ...data,
  create_time: data.create_time.getTime(),
})

export const route = tsr.router(contract.route, {
  get: routeMiddleware(async (_, { route }) => {
    return { status: 200, body: routeDataToRoute(route) }
  }),
  setPublic: routeMiddleware(async ({ body }, { route, permission }) => {
    if (permission !== 'owner') throw new ForbiddenError()

    const updated = await db.update(routesTable).set({ is_public: body.is_public }).where(eq(routesTable.fullname, route.fullname)).returning()
    if (updated.length !== 1) throw new InternalServerError()

    return { status: 200, body: routeDataToRoute(updated[0]) }
  }),
  preserve: routeMiddleware(async (_, { route, permission }) => {
    if (permission !== 'owner') throw new ForbiddenError()

    await db.update(routesTable).set({ is_preserved: true }).where(eq(routesTable.fullname, route.fullname))
    return { status: 200, body: { success: 1 } }
  }),
  unPreserve: routeMiddleware(async (_, { route, permission }) => {
    if (permission !== 'owner') throw new ForbiddenError()

    await db.update(routesTable).set({ is_preserved: false }).where(eq(routesTable.fullname, route.fullname))
    return { status: 200, body: { success: 1 } }
  }),
  shareSignature: routeMiddleware(async (_, { route }) => {
    const routeId = route.fullname.split('|')[1]
    const exp = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const sig = createRouteSignature(route.dongle_id, routeId, 'read_access', 24 * 60 * 60)

    return { status: 200, body: { exp, sig } }
  }),
  files: routeMiddleware(async (_, { route, origin }) => {
    const routeId = route.fullname.split('|')[1]
    const key = `${route.dongle_id}/${routeId}`
    const existingFiles = await mkv.list(key)

    const files: Files = {
      cameras: [],
      dcameras: [],
      ecameras: [],
      logs: [],
      qcameras: [],
      qlogs: [],
    }

    const fileMap: Record<string, keyof Files> = {
      'fcamera.hevc': 'cameras',
      'dcamera.hevc': 'dcameras',
      'ecamera.hevc': 'ecameras',
      'rlog.zst': 'logs',
      'qcamera.ts': 'qcameras',
      'qlog.zst': 'qlogs',
    }

    for (const file of existingFiles) {
      const parts = file.split('/')
      if (parts.length !== 2) continue

      const [segment, filename] = parts
      const fileType = fileMap[filename]
      if (!fileType) continue

      const segKey = `${key}/${segment}`
      const segSig = createDataSignature(segKey, 'read_access', 24 * 60 * 60)
      files[fileType].push(`${origin}/connectdata/${segKey}/${filename}?sig=${segSig}`)
    }

    return { status: 200, body: files }
  }),
})
