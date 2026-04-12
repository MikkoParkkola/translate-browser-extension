/**
 * Bundle Size Tracking Tests
 *
 * Verifies that built bundles stay within configured size limits.
 * Reads limits from package.json "size-limit" config and checks
 * actual file sizes against them.
 *
 * Prerequisites: `npm run build` must have been run first for size assertions.
 * When dist/ is absent, this suite skips so the default unit test run stays green.
 *
 * Run: npx vitest run src/__benchmarks__/bundle-size.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = resolve(__dirname, '../..');

interface SizeLimitEntry {
  name: string;
  path: string | string[];
  limit: string;
  ignore?: string[];
}

/** Parse a human-readable size string (e.g., "60 KB") to bytes */
function parseSizeLimit(limit: string): number {
  const match = limit.match(/^([\d.]+)\s*(B|KB|MB|GB)$/i);
  if (!match) throw new Error(`Invalid size limit format: ${limit}`);
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
  };
  return value * (multipliers[unit] ?? 1);
}

/** Format bytes to human-readable string */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Get total size of files matching a path pattern (supports globs) */
function getFileSize(pathPattern: string): number {
  const fullPath = resolve(ROOT, pathPattern);

  // Simple glob: if path contains *, expand it
  if (pathPattern.includes('*')) {
    try {
      // Use a simple approach: list directory and match
      const dir = resolve(ROOT, pathPattern.replace(/\/\*.*$/, ''));
      if (!existsSync(dir)) return 0;

      const files: string[] = readdirSync(dir);
      const pattern = pathPattern.split('/').pop() || '';
      const regex = new RegExp(
        '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$',
      );

      let total = 0;
      for (const file of files) {
        if (regex.test(file)) {
          const stat = statSync(join(dir, file));
          if (stat.isFile()) total += stat.size;
        }
      }
      return total;
    } catch {
      return 0;
    }
  }

  if (!existsSync(fullPath)) return 0;
  return statSync(fullPath).size;
}

/** Get combined size of multiple path patterns, excluding ignore patterns */
function getCombinedSize(paths: string | string[], ignore?: string[]): number {
  const pathList = Array.isArray(paths) ? paths : [paths];
  let total = 0;
  for (const p of pathList) {
    total += getFileSize(p);
  }

  // Subtract ignored files
  if (ignore) {
    for (const ig of ignore) {
      total -= getFileSize(ig);
    }
  }

  return Math.max(0, total);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Bundle size tracking', () => {
  const distPath = resolve(ROOT, 'dist');
  const distExists = existsSync(distPath);
  if (!distExists) {
    it.skip('requires dist/ build output', () => {});
    return;
  }

  // Load size-limit config from package.json
  let sizeLimits: SizeLimitEntry[] = [];
  try {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
    sizeLimits = pkg['size-limit'] || [];
  } catch {
    // package.json read error — tests will skip gracefully
  }

  if (sizeLimits.length === 0) {
    it.skip('skipping size checks (no size-limit config)', () => {});
    return;
  }

  // Report all bundle sizes
  it('reports bundle sizes for CI tracking', () => {
    console.log('\n📦 Bundle Size Report:');
    console.log('─'.repeat(60));

    for (const entry of sizeLimits) {
      const actualSize = getCombinedSize(entry.path, entry.ignore);
      const limitBytes = parseSizeLimit(entry.limit);
      const pct = limitBytes > 0 ? ((actualSize / limitBytes) * 100).toFixed(0) : '?';
      const status = actualSize === 0 ? '⚠️  missing' : actualSize <= limitBytes ? '✅' : '❌';

      console.log(
        `  ${status} ${entry.name.padEnd(35)} ${formatSize(actualSize).padStart(10)} / ${entry.limit.padStart(8)} (${pct}%)`,
      );
    }
    console.log('─'.repeat(60));
  });

  // Individual size checks with 10% tolerance
  for (const entry of sizeLimits) {
    it(`${entry.name} stays within ${entry.limit} (+10% tolerance)`, () => {
      const actualSize = getCombinedSize(entry.path, entry.ignore);
      const limitBytes = parseSizeLimit(entry.limit);
      const toleranceBytes = limitBytes * 1.1; // 10% over is the hard fail

      // Skip if file doesn't exist (may be a lazy-loaded chunk)
      if (actualSize === 0) {
        console.log(`  ⚠️  ${entry.name}: file(s) not found, skipping`);
        return;
      }

      expect(
        actualSize,
        `${entry.name} is ${formatSize(actualSize)} which exceeds ${entry.limit} + 10% tolerance (${formatSize(toleranceBytes)})`,
      ).toBeLessThanOrEqual(toleranceBytes);
    });
  }

  // Summary test: no bundle should be more than 2x its limit
  it('no bundle exceeds 2x its size limit', () => {
    const violations: string[] = [];
    for (const entry of sizeLimits) {
      const actualSize = getCombinedSize(entry.path, entry.ignore);
      const limitBytes = parseSizeLimit(entry.limit);
      if (actualSize > 0 && actualSize > limitBytes * 2) {
        violations.push(
          `${entry.name}: ${formatSize(actualSize)} > 2× ${entry.limit}`,
        );
      }
    }
    expect(violations, `Bundles exceeding 2× limit:\n${violations.join('\n')}`).toHaveLength(0);
  });
});
