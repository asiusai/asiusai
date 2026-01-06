import { contract } from '../../connect/src/api/contract'
import { NotImplementedError, tsr } from '../common'
import { routeMiddleware } from '../middleware'

export const route = tsr.router(contract.route, {
  files: routeMiddleware(async () => {
    throw new NotImplementedError()
  }),
  get: routeMiddleware(async () => {
    throw new NotImplementedError()
  }),
  preserve: routeMiddleware(async () => {
    throw new NotImplementedError()
  }),
  setPublic: routeMiddleware(async () => {
    throw new NotImplementedError()
  }),
  shareSignature: routeMiddleware(async () => {
    throw new NotImplementedError()
  }),
  unPreserve: routeMiddleware(async () => {
    throw new NotImplementedError()
  }),
})
