export class E2eAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'E2eAssertionError';
  }
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new E2eAssertionError(message);
  }
}

export function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new E2eAssertionError(`${label}: expected "${expected}", got "${actual}"`);
  }
}

export function assertOneOf<T>(actual: T, expected: T[], label: string): void {
  if (!expected.includes(actual)) {
    throw new E2eAssertionError(`${label}: expected one of [${expected.join(', ')}], got "${actual}"`);
  }
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
