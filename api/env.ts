import { z } from 'zod'

export const Environment = z.object({
  MKV_PORT: z.coerce.number().default(5100),
  MKV_VOLUMES: z
    .string()
    .default('/tmp/mkv0,/tmp/mkv1')
    .transform((x) => x.split(',')),
  MKV_DB: z.string().default('/tmp/mkvdb'),

  DB_URL: z.string().default('file:///tmp/data.db'),
  DB_AUTH: z.string().optional(),

  JWT_SECRET: z.string(),
  GOOGLE_CLIENT_ID: z.string(),
  GOOGLE_CLIENT_SECRET: z.string(),
})

export const env = Environment.parse(process.env)
