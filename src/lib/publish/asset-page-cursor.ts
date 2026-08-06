export interface PublishAssetCursor {
  v: 1
  createdAt: string
  id: string
}

const MAX_CURSOR_LENGTH = 512
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATABASE_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/

function daysInMonth(year: number, month: number) {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    return leapYear ? 29 : 28
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function isSafeDatabaseTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = DATABASE_TIMESTAMP_PATTERN.exec(value)
  if (!match) return false

  const [
    ,
    rawYear,
    rawMonth,
    rawDay,
    rawHour,
    rawMinute,
    rawSecond,
    ,
    zone,
    ,
    rawOffsetHour,
    rawOffsetMinute,
  ] = match
  const year = Number(rawYear)
  const month = Number(rawMonth)
  const day = Number(rawDay)
  const hour = Number(rawHour)
  const minute = Number(rawMinute)
  const second = Number(rawSecond)
  const offsetHour = zone === 'Z' ? 0 : Number(rawOffsetHour)
  const offsetMinute = zone === 'Z' ? 0 : Number(rawOffsetMinute)

  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59 &&
    offsetHour >= 0 &&
    offsetHour <= 14 &&
    offsetMinute >= 0 &&
    offsetMinute <= 59 &&
    (offsetHour !== 14 || offsetMinute === 0)
  )
}

function isPublishAssetCursor(value: unknown): value is PublishAssetCursor {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const cursor = value as Record<string, unknown>
  return (
    Object.keys(cursor).length === 3 &&
    cursor.v === 1 &&
    isSafeDatabaseTimestamp(cursor.createdAt) &&
    typeof cursor.id === 'string' &&
    UUID_PATTERN.test(cursor.id)
  )
}

export function encodePublishAssetCursor(input: { createdAt: string; id: string }) {
  const cursor: PublishAssetCursor = {
    v: 1,
    // Preserve PostgreSQL's original fractional precision. Converting through
    // Date/toISOString truncates microseconds and can make keyset pagination
    // skip rows that share the same millisecond.
    createdAt: input.createdAt,
    id: input.id,
  }
  if (!isPublishAssetCursor(cursor)) throw new Error('Invalid publish asset cursor values')
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodePublishAssetCursor(token: string): PublishAssetCursor {
  if (
    token.length === 0 ||
    token.length > MAX_CURSOR_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(token)
  ) {
    throw new Error('Invalid publish asset cursor')
  }

  let parsed: unknown
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8')
    parsed = JSON.parse(decoded)
  } catch {
    throw new Error('Invalid publish asset cursor')
  }

  if (!isPublishAssetCursor(parsed)) throw new Error('Invalid publish asset cursor')
  if (encodePublishAssetCursor(parsed) !== token) throw new Error('Invalid publish asset cursor')
  return parsed
}

export function buildPublishAssetCursorFilter(cursor: PublishAssetCursor) {
  return [
    `created_at.lt.${cursor.createdAt}`,
    `and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
  ].join(',')
}
