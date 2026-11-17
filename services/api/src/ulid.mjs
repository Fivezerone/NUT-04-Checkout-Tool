// services/api/src/ulid.mjs
// Monotonic 26-character Crockford Base32 ULID generator
import { randomBytes as nodeRandomBytes } from 'node:crypto'

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

let lastTimestamp = -1
let lastRandom = new Uint8Array(10)

export function generateUlid(ts = Date.now()) {
  const time = Math.max(0, Math.floor(ts))
  let timeStr = ''

  for (let i = 9; i >= 0; i--) {
    const mod = Math.floor(time / Math.pow(32, i)) % 32
    timeStr += CROCKFORD_BASE32[mod]
  }

  const randomBytes = new Uint8Array(10)
  if (time === lastTimestamp) {
    let carry = 1
    for (let i = 9; i >= 0; i--) {
      const sum = (lastRandom[i] || 0) + carry
      randomBytes[i] = sum % 256
      carry = Math.floor(sum / 256)
    }
  } else {
    const buf = nodeRandomBytes(10)
    for (let i = 0; i < 10; i++) randomBytes[i] = buf[i]
  }

  lastTimestamp = time
  lastRandom = randomBytes

  let randomStr = ''
  for (let i = 0; i < 16; i++) {
    // 80 bits into 16 5-bit chunks
    const bitPos = i * 5
    const bytePos = Math.floor(bitPos / 8)
    const bitOffset = bitPos % 8
    let val = ((randomBytes[bytePos] || 0) << 8) | (randomBytes[bytePos + 1] || 0)
    val = (val >> (11 - bitOffset)) & 0x1f
    randomStr += CROCKFORD_BASE32[val % 32]
  }

  return timeStr + randomStr
}

const ULID_PATTERN = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/i

export function isValidUlid(val) {
  return typeof val === 'string' && val.length === 26 && ULID_PATTERN.test(val)
}
