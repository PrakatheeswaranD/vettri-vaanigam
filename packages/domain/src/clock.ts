/**
 * Injectable clock (PART 02 §35, §81).
 *
 * Freshness scoring depends on "now". Reading `Date.now()` directly
 * inside a scoring function makes it impossible to write a deterministic,
 * non-flaky test for a time-dependent rule. Production code uses
 * `systemClock`; tests pass a fixed-time stub.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function fixedClock(isoTimestamp: string): Clock {
  const fixed = new Date(isoTimestamp);
  return { now: () => fixed };
}

export function hoursBetween(earlier: Date, later: Date): number {
  return (later.getTime() - earlier.getTime()) / (1000 * 60 * 60);
}
