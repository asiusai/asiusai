import { contract } from '../../connect/src/api/contract'
import { tsr } from '../common'
import { athenaMiddleware } from '../middleware'
import { sendToDevice } from '../ws'

export const athena = tsr.router(contract.athena, {
  athena: athenaMiddleware(async ({ body }, { device }) => {
    const timeout = body.params?.timeout || 10000
    const response = await sendToDevice(device.dongle_id, body.method, body.params, timeout)

    if (response.queued) return { status: 202, body: { queued: true, result: response.result } }

    return { status: 200, body: response }
  }),
})
