import { describe, expect, test } from 'bun:test'
import { processQlogStream, type RouteEvent, type Coord } from './qlogs'

const TEST_DATA_DIR = import.meta.dir + '/../../example-data'
const SEGMENT_PREFIXES = [
  '9748a98e983e0b39_0000002c--d68dde99ca--0',
  '9748a98e983e0b39_0000002c--d68dde99ca--1',
  '9748a98e983e0b39_0000002c--d68dde99ca--2',
]

describe('qlogs', () => {
  for (const prefix of SEGMENT_PREFIXES) {
    const segment = Number(prefix.split('--').pop())

    test(`${prefix} events match comma API`, async () => {
      const qlogFile = Bun.file(`${TEST_DATA_DIR}/${prefix}--qlog.zst`)
      const expectedFile = Bun.file(`${TEST_DATA_DIR}/${prefix}--events.json`)

      const stream = qlogFile.stream()
      const result = await processQlogStream(stream, segment)
      expect(result).not.toBeNull()
      const { events } = result!
      const expected = (await expectedFile.json()) as RouteEvent[]

      expect(events.length).toBe(expected.length)

      for (let i = 0; i < expected.length; i++) {
        expect(events[i].type).toBe(expected[i].type)
        expect(events[i].data).toEqual(expected[i].data)
      }

      const recordFrontToggle = events.find((e) => e.type === 'event' && (e.data as any).event_type === 'record_front_toggle')
      const firstRoadCameraFrame = events.find((e) => e.type === 'event' && (e.data as any).event_type === 'first_road_camera_frame')
      expect(recordFrontToggle).toBeDefined()
      expect(firstRoadCameraFrame).toBeDefined()
    })

    test(`${prefix} coords match comma API`, async () => {
      const qlogFile = Bun.file(`${TEST_DATA_DIR}/${prefix}--qlog.zst`)
      const expectedFile = Bun.file(`${TEST_DATA_DIR}/${prefix}--coords.json`)

      const stream = qlogFile.stream()
      const result = await processQlogStream(stream, segment)
      expect(result).not.toBeNull()
      const { coords } = result!
      const expected = (await expectedFile.json()) as Coord[]

      expect(Math.abs(coords.length - expected.length)).toBeLessThan(5)

      if (coords.length > 0 && expected.length > 0) {
        expect(coords[0].lat).toBeCloseTo(expected[0].lat, 3)
        expect(coords[0].lng).toBeCloseTo(expected[0].lng, 3)
      }
    })
  }
})
