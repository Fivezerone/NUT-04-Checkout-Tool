// Type declarations for Node.js crypto primitives in shared modules

declare namespace NodeJS {
  interface Process {
    env?: Record<string, string | undefined>
  }
}

declare const process: NodeJS.Process | undefined

declare class Buffer extends Uint8Array {
  static from(data: any, encoding?: string): Buffer
  static alloc(size: number, fill?: number): Buffer
  static concat(list: readonly Uint8Array[], totalLength?: number): Buffer
  static isBuffer(obj: any): boolean
  toString(encoding?: string): string
  subarray(start?: number, end?: number): Buffer
  copy(target: Uint8Array, targetStart?: number, sourceStart?: number, sourceEnd?: number): number
  readUInt16BE(offset: number): number
  writeUInt16BE(value: number, offset: number): number
}

declare module 'node:crypto' {
  export interface CipherGCM {
    setAAD(aad: Uint8Array): void
    update(data: Uint8Array): Buffer
    final(): Buffer
    getAuthTag(): Buffer
  }

  export interface DecipherGCM {
    setAuthTag(tag: Uint8Array): void
    setAAD(aad: Uint8Array): void
    update(data: Uint8Array): Buffer
    final(): Buffer
  }

  export interface Hmac {
    update(data: Uint8Array): Hmac
    digest(): Buffer
  }

  export interface Hash {
    update(data: Uint8Array | string): Hash
    digest(encoding?: string): any
  }

  export interface KeyObject {
    export(options: { type: string; format: string }): any
  }

  export interface KeyPairSyncResult {
    publicKey: KeyObject
    privateKey: KeyObject
  }

  export function createHash(algorithm: string): Hash
  export function createCipheriv(algorithm: string, key: Uint8Array, iv: Uint8Array): CipherGCM
  export function createDecipheriv(algorithm: string, key: Uint8Array, iv: Uint8Array): DecipherGCM
  export function createHmac(algorithm: string, key: Uint8Array): Hmac
  export function randomBytes(size: number): Buffer
  export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean
  export function createPublicKey(key: any): KeyObject
  export function generateKeyPairSync(type: string, options?: any): KeyPairSyncResult
  export function sign(
    algorithm: string | null | undefined,
    data: Uint8Array,
    key: KeyObject | any,
  ): Buffer
  export function verify(
    algorithm: string | null | undefined,
    data: Uint8Array,
    key: KeyObject | any,
    signature: Uint8Array,
  ): boolean
}
