import { and, desc, eq } from "drizzle-orm";
import { contract } from "../../connect/src/api/contract";
import { NotImplementedError, tsr } from "../common";
import { db } from "../db/client";
import { athenaPingsTable, DeviceData, deviceUsersTable } from "../db/schema";
import { createDataSignature, deviceMiddleware } from "../middleware";
import { Device } from "../../connect/src/types";
import { Identity } from "../auth";

export const deviceDataToDevice = async (device: DeviceData, identity: Identity): Promise<Device> => {
  const lastPing = await db.query.athenaPingsTable.findFirst({ orderBy: desc(athenaPingsTable.create_time) });
  const owner = await db.query.deviceUsersTable.findFirst({
    where: and(eq(deviceUsersTable.dongle_id, device.dongle_id), eq(deviceUsersTable.permission, "owner")),
  });
  return {
    ...device,
    last_athena_ping: lastPing?.create_time.getTime() ?? device.create_time.getTime(),
    is_paired: !!owner,
    is_owner: identity.type === "device" || owner?.user_id === identity.user.id,
    // prime
    eligible_features: { prime: true, prime_data: true, nav: true },
    prime: true,
    prime_type: 2,
    trial_claimed: true,
  };
};

export const device = tsr.routerWithMiddleware(contract.device)<{ userId?: string }>({
  get: deviceMiddleware(async (_, { device, identity }) => {
    return { status: 200, body: await deviceDataToDevice(device, identity) };
  }),
  athenaOfflineQueue: deviceMiddleware(async () => {
    throw new NotImplementedError();
  }),
  bootlogs: deviceMiddleware(async () => {
    throw new NotImplementedError();
  }),
  crashlogs: deviceMiddleware(async () => {
    throw new NotImplementedError();
  }),
  location: deviceMiddleware(async () => {
    throw new NotImplementedError();
  }),
  set: deviceMiddleware(async () => {
    throw new NotImplementedError();
  }),
  stats: deviceMiddleware(async () => {
    throw new NotImplementedError();
  }),
  unpair: deviceMiddleware(async () => {
    throw new NotImplementedError();
  }),
  uploadFiles: deviceMiddleware(async () => {
    throw new NotImplementedError();
  }),
  firehoseStats: deviceMiddleware(async () => {
    // TODO
    return { status: 200, body: { firehose: 69 } };
  }),
  getUploadUrl: deviceMiddleware(async ({ params, query }, { origin }) => {
    const key = `${params.dongleId}/${query.path}`;
    const sig = createDataSignature(key, "owner");
    const url = `${origin}/connectdata/${key}?sig=${sig}`;
    return { status: 200, body: { url, headers: {} } };
  }),
});
