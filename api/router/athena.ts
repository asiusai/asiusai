import { contract } from '../../connect/src/api/contract'
import { tsr } from '../common'
import { deviceMiddleware } from '../middleware'
import { sendToDevice } from '../ws'

export const athena = tsr.router(contract.athena, {
  athena: deviceMiddleware(async ({ body, params }) => {
    const timeout = body.params?.timeout || 10000
    const response = await sendToDevice(params.dongleId, body.method, body.params, timeout)

    if (response.queued) {
      return { status: 202, body: { queued: true, result: response.result } }
    }

    return { status: 200, body: response }
  }),
})
