/// <reference types="vite/client" />

// Minimal typing for the bun test runner used by server/*.test.ts (avoids adding @types/bun).
declare module 'bun:test' {
  export const describe: { (name: string, fn: () => void): void; skip(name: string, fn: () => void): void }
  export function test(name: string, fn: () => void | Promise<void>): void
  export function beforeAll(fn: () => void | Promise<void>): void
  export function afterAll(fn: () => void | Promise<void>): void
  export function expect(value: unknown): {
    toBe(expected: unknown): void
    toEqual(expected: unknown): void
    toMatchObject(expected: object): void
    toBeNull(): void
    toThrow(): void
    toBeGreaterThan(n: number): void
    toContain(s: string): void
    toBeGreaterThanOrEqual(n: number): void
    toBeUndefined(): void
    toBeLessThan(n: number): void
    toBeInstanceOf(c: unknown): void
    rejects: { toThrow(): Promise<void>; toMatchObject(expected: object): Promise<void>; toBeInstanceOf(c: unknown): Promise<void> }
  }
}

interface ImportMetaEnv {
  /** Optional public override of the payment recipient (a wallet address, not a secret). */
  readonly VITE_PAYMENT_RECIPIENT?: string
  /** Optional public Arc RPC URL used to read payments from the chain. */
  readonly VITE_PAYMENT_RPC_URL?: string
}
