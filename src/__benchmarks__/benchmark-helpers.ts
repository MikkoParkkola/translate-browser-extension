const COVERAGE_LIFECYCLE_EVENTS = new Set([
  'test:coverage',
  'validate:coverage',
]);

export const IS_COVERAGE_RUN =
  process.argv.includes('--coverage') ||
  COVERAGE_LIFECYCLE_EVENTS.has(process.env.npm_lifecycle_event ?? '');

function median(timings: number[]): number {
  const sorted = [...timings].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

export function measureSync(
  fn: () => void,
  iterations: number,
  warmupIterations = Math.min(5, iterations),
): number {
  for (let i = 0; i < warmupIterations; i++) fn();

  const timings: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    timings.push(performance.now() - start);
  }

  return median(timings);
}

export async function measureAsync(
  fn: () => Promise<void>,
  iterations: number,
  warmupIterations = Math.min(3, iterations),
): Promise<number> {
  for (let i = 0; i < warmupIterations; i++) await fn();

  const timings: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    timings.push(performance.now() - start);
  }

  return median(timings);
}

export function createRoundRobinIndexPicker(count: number): () => number {
  let nextIndex = 0;

  return () => {
    const currentIndex = nextIndex;
    nextIndex = (nextIndex + 1) % count;
    return currentIndex;
  };
}

/** FNV-1a hash — mirrors translation-cache.ts. */
export function hashTranslationCacheKey(
  text: string,
  sourceLang: string,
  targetLang: string,
  provider: string,
): string {
  const input = `${text}|${sourceLang}|${targetLang}|${provider}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
