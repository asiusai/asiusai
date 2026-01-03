import { contract } from '../../connect/src/api/contract'
import { tsr } from '../tsr'

export const device = tsr.router(contract.device, {
  // TODO
} as any)
