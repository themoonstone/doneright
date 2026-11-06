/**
 * Minimal assertion helpers on top of node:test.
 *
 * Vitest/Vite cannot run in this sandbox (Vite shells out to `net use`, which
 * the file sandbox rejects with EPERM), so the suite uses Node's built-in test
 * runner and this small matcher shim instead.
 */
import assert from 'node:assert/strict';

export { describe, it } from 'node:test';

type Thunk = () => unknown;

class Matchers {
  constructor(
    private readonly actual: unknown,
    private readonly negated = false,
  ) {}

  get not(): Matchers {
    return new Matchers(this.actual, !this.negated);
  }

  private check(ok: boolean, message: string): void {
    if (this.negated ? ok : !ok) {
      throw new assert.AssertionError({ message: `${this.negated ? 'NOT ' : ''}${message}` });
    }
  }

  toBe(expected: unknown): void {
    const ok = Object.is(this.actual, expected);
    this.check(ok, `expected ${format(this.actual)} to be ${format(expected)}`);
  }

  toEqual(expected: unknown): void {
    const ok = JSON.stringify(this.actual) === JSON.stringify(expected);
    this.check(ok, `expected ${format(this.actual)} to equal ${format(expected)}`);
  }

  toBeGreaterThan(expected: number): void {
    this.check(Number(this.actual) > expected, `expected ${format(this.actual)} > ${expected}`);
  }

  toBeLessThan(expected: number): void {
    this.check(Number(this.actual) < expected, `expected ${format(this.actual)} < ${expected}`);
  }

  toBeTruthy(): void {
    this.check(Boolean(this.actual), `expected ${format(this.actual)} to be truthy`);
  }

  toHaveLength(length: number): void {
    const actual = this.actual as { length?: number };
    this.check(actual?.length === length, `expected length ${length}, got ${actual?.length}`);
  }

  toContain(needle: unknown): void {
    const ok =
      typeof this.actual === 'string'
        ? this.actual.includes(String(needle))
        : Array.isArray(this.actual) && this.actual.includes(needle);
    this.check(ok, `expected ${format(this.actual)} to contain ${format(needle)}`);
  }

  toThrow(expected?: RegExp | string): void {
    let thrown: unknown;
    try {
      (this.actual as Thunk)();
    } catch (error) {
      thrown = error;
    }
    if (!thrown) {
      this.check(false, 'expected function to throw');
      return;
    }
    if (expected instanceof RegExp) {
      this.check(expected.test(String((thrown as Error).message)), `error ${format(thrown)} to match ${expected}`);
    } else if (expected) {
      this.check(String((thrown as Error).message).includes(expected), `error to include ${expected}`);
    } else {
      this.check(true, '');
    }
  }
}

function format(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function expect(actual: unknown): Matchers {
  return new Matchers(actual);
}
