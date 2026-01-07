import { and, eq } from 'drizzle-orm'
import { Context, UnauthorizedError, BadRequestError, ForbiddenError, NotFoundError, verify, sign } from './common'
import { db } from './db/client'
import { deviceUsersTable, devicesTable, segmentsTable, routeSettingsTable } from './db/schema'
import { env } from './env'
import { Permission, Route } from '../connect/src/types'

type Ctx = { request: Request; appRoute: any; responseHeaders: Headers } & Context
type MiddleWare<Req, CtxOut> = (req: Req, ctx: Ctx) => Promise<CtxOut>
type Fn<Req, Ctx, Res> = (req: Req, ctx: Ctx) => Promise<Res>

export const createMiddleware = <OuterReq, CtxOut>(middleware: MiddleWare<OuterReq, CtxOut>) => {
  return <InnerReq extends OuterReq, Res>(fn: Fn<InnerReq, CtxOut, Res>) => {
    return async (req: InnerReq, ctx: Ctx) => {
      const newCtx = await middleware(req, ctx)
      return await fn(req, newCtx)
    }
  }
}

export const noMiddleware = createMiddleware(async (_, ctx) => ({ ...ctx }))

export const authenticatedMiddleware = createMiddleware(async (_, ctx) => {
  const identity = ctx.identity
  if (!identity) throw new UnauthorizedError()
  return { ...ctx, identity }
})

export const userMiddleware = createMiddleware(async (_, ctx) => {
  const identity = ctx.identity
  if (!identity || identity.type !== 'user') throw new UnauthorizedError()
  return { ...ctx, identity }
})

/**
 * Checks if device or user has access to the requested device
 */
export const deviceMiddleware = createMiddleware(async (req: { params: { dongleId: string } }, { identity, ...ctx }) => {
  if (!identity) throw new UnauthorizedError()
  if (identity.type === 'device') {
    if (identity.device.dongle_id !== req.params.dongleId) throw new ForbiddenError()
    return { ...ctx, identity, device: identity.device, permission: 'owner' as const }
  }

  const deviceUser = await db.query.deviceUsersTable.findFirst({
    where: and(eq(deviceUsersTable.user_id, identity.id), eq(deviceUsersTable.dongle_id, req.params.dongleId)),
    with: { device: true },
  })
  if (!deviceUser) throw new ForbiddenError()

  return { ...ctx, identity, device: deviceUser.device, permission: deviceUser.permission }
})

type RouteSignature = { key: string; permission: Permission }
export const createRouteSignature = (dongleId: string, routeId: string, permission: Permission, expiresIn?: number) =>
  sign({ key: `${dongleId}/${routeId}`, permission }, env.JWT_SECRET, expiresIn)

// Aggregate route from segments
const aggregateRouteFromSegments = async (dongleId: string, routeId: string, origin: string): Promise<Route | null> => {
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

  const sig = createDataSignature(`${dongleId}/${routeId}`, 'read_access', 24 * 60 * 60)
  const routeName = encodeURIComponent(`${dongleId}|${routeId}`)

  return {
    dongle_id: dongleId,
    fullname: `${dongleId}|${routeId}`,
    create_time: firstSeg.create_time,
    start_time: firstSeg.start_time ? new Date(firstSeg.start_time).toISOString() : null,
    end_time: lastSeg.end_time ? new Date(lastSeg.end_time).toISOString() : null,
    start_lat: firstSeg.start_lat,
    start_lng: firstSeg.start_lng,
    end_lat: lastSeg.end_lat,
    end_lng: lastSeg.end_lng,
    distance: segments.reduce((sum, s) => sum + (s.distance ?? 0), 0),
    version: firstSeg.version,
    git_branch: firstSeg.git_branch,
    git_commit: firstSeg.git_commit,
    git_commit_date: firstSeg.git_commit_date,
    git_dirty: firstSeg.git_dirty,
    git_remote: firstSeg.git_remote,
    maxqlog: maxSegment,
    procqlog: maxSegment,
    is_public: settings?.is_public ?? false,
    platform: firstSeg.platform,
    url: `${origin}/v1/route/${routeName}/derived/${sig}`,
    user_id: null,
    vin: firstSeg.vin,
    make: firstSeg.platform?.split('_')[0]?.toLowerCase() ?? null,
    id: null,
    car_id: null,
    version_id: null,
  }
}

/**
 * Checks if route is public, has valid signature, or user has access to the requested route
 */
export const routeMiddleware = createMiddleware(
  async (req: { params: { routeName: string; sig?: string }; query?: { sig?: string } }, { identity, ...ctx }) => {
    const [dongleId, routeId] = decodeURIComponent(req.params.routeName).split('|')
    if (!dongleId || !routeId) throw new NotFoundError()

    const route = await aggregateRouteFromSegments(dongleId, routeId, ctx.origin)
    if (!route) throw new NotFoundError()

    // Check signature access
    const sig = req.params.sig ?? req.query?.sig
    if (sig) {
      const expectedKey = `${dongleId}/${routeId}`
      const signature = verify<RouteSignature>(sig, env.JWT_SECRET)
      if (signature && signature.key === expectedKey) {
        return { ...ctx, identity, route, permission: signature.permission }
      }
    }

    // Public routes are accessible without auth
    if (route.is_public) return { ...ctx, identity, route, permission: 'read_access' as const }

    // Otherwise require authentication
    if (!identity) throw new UnauthorizedError()
    if (identity.type === 'device') throw new ForbiddenError()

    const deviceUser = await db.query.deviceUsersTable.findFirst({
      where: and(eq(deviceUsersTable.user_id, identity.user.id), eq(deviceUsersTable.dongle_id, dongleId)),
      with: { device: true },
    })
    if (!deviceUser) throw new ForbiddenError()

    return { ...ctx, identity, route, permission: deviceUser.permission }
  },
)

type DataSignature = { key: string; permission: Permission }
export const createDataSignature = (key: string, permission: Permission, expiresIn?: number) => sign({ key, permission }, env.JWT_SECRET, expiresIn)

/**
 * Checks if sig or user or device has access to specific key
 */
export const dataMiddleware = createMiddleware(async (req: { params: { _key: string }; query: { sig?: string } }, { identity, ...ctx }) => {
  const rawKeys = new URL(ctx.request.url).pathname.replace('/connectdata/', '').replaceAll('%2F', '/').replaceAll('*', '').trim().split('/').filter(Boolean)
  const key = rawKeys.join('/')

  // We only support keys that prefix with /dongleId/
  const dongleId = key.split('/')[0]
  if (!dongleId) throw new BadRequestError(`No dongleId`)

  if (req.query.sig) {
    const signature = verify<DataSignature>(req.query.sig, env.JWT_SECRET)
    if (!signature || signature.key !== key) throw new ForbiddenError()
    const device = await db.query.devicesTable.findFirst({ where: eq(devicesTable.dongle_id, dongleId) })
    if (!device) throw new NotFoundError()
    return { ...ctx, identity, permission: signature.permission, key, device }
  }

  // if (dongleId) return { ...ctx, identity, permission: 'owner', key }

  if (!identity) throw new UnauthorizedError()
  if (identity.type === 'device') {
    if (identity.device.dongle_id !== dongleId) throw new ForbiddenError()
    return { ...ctx, identity, permission: 'owner' as const, device: identity.device, key }
  }

  const deviceUser = await db.query.deviceUsersTable.findFirst({
    where: and(eq(deviceUsersTable.dongle_id, dongleId), eq(deviceUsersTable.user_id, identity.user.id)),
    with: { device: true },
  })
  if (!deviceUser) throw new ForbiddenError()

  return { ...ctx, identity, permission: deviceUser.permission, key, device: deviceUser.device }
})
