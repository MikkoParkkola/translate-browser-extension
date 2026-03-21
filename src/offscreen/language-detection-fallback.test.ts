/**
 * Test for the FRANC_TO_ISO fallback branch in detectLanguage.
 * Uses vi.mock to make franc return an unmapped ISO 639-3 code.
 */
import { describe, it, expect, vi } from 'vitest';

// Mock franc-min to return a code NOT in FRANC_TO_ISO
vi.mock('franc-min', () => ({
  franc: vi.fn(() => 'zzj'), // fictional ISO 639-3 code — NOT in our FRANC_TO_ISO mapping
}));

vi.mock('../core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { detectLanguage } from './language-detection';

describe('detectLanguage unmapped franc code', () => {
  it('returns en when franc returns a code not in FRANC_TO_ISO', () => {
    // franc is mocked to return 'xho' which is not in our FRANC_TO_ISO mapping
    // Need text long enough (>= 20 chars) to bypass the short-text heuristics
    const result = detectLanguage(
      'This is a sufficiently long text for franc detection to actually run the franc library'
    );
    expect(result).toBe('en');
  });
});
