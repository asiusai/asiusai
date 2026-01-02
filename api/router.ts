import { tsr } from '@ts-rest/serverless/fetch'
import { contract } from '../connect/src/api/contract'

export const router = tsr.platformContext<{}>().router(contract, {
  // TODO
} as any)
