import { contract } from '../../connect/src/api/contract'
import { NotImplementedError, tsr } from '../common'
import { deviceMiddleware } from '../middleware'

export const users = tsr.router(contract.users, {
  get: deviceMiddleware(async () => {
    throw new NotImplementedError()
  }),
  addUser: deviceMiddleware(async () => {
    throw new NotImplementedError()
  }),
  deleteUser: deviceMiddleware(async () => {
    throw new NotImplementedError()
  }),
})
