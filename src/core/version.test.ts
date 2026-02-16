/**
 * Version detection unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkVersion, dismissUpdateNotice, isUpdateDismissed } from './version';

// Mock chrome APIs
const mockStorage: Record<string, unknown> = {};
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn((keys: string[]) => {
        const result: Record<string, unknown> = {};
        for (const key of keys) {
          if (mockStorage[key] !== undefined) {
            result[key] = mockStorage[key];
          }
        }
        return Promise.resolve(result);
      }),
      set: vi.fn((items: Record<string, unknown>) => {
        Object.assign(mockStorage, items);
        return Promise.resolve();
      }),
    },
  },
  runtime: {
    getManifest: vi.fn(() => ({ version: '2.1.3' })),
  },
});

describe('version detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
  });

  describe('checkVersion', () => {
    it('detects first run when no stored version', async () => {
      const info = await checkVersion();
      expect(info.isFirstRun).toBe(true);
      expect(info.isUpdate).toBe(false);
      expect(info.current).toBe('2.1.3');
      expect(info.previous).toBeNull();
    });

    it('detects update when stored version differs', async () => {
      mockStorage['extension_version'] = '2.0.0';

      const info = await checkVersion();
      expect(info.isFirstRun).toBe(false);
      expect(info.isUpdate).toBe(true);
      expect(info.current).toBe('2.1.3');
      expect(info.previous).toBe('2.0.0');
    });

    it('detects no update when versions match', async () => {
      mockStorage['extension_version'] = '2.1.3';

      const info = await checkVersion();
      expect(info.isFirstRun).toBe(false);
      expect(info.isUpdate).toBe(false);
    });

    it('persists current version on first run', async () => {
      await checkVersion();
      expect(mockStorage['extension_version']).toBe('2.1.3');
      expect(mockStorage['extension_updated_at']).toBeDefined();
    });

    it('persists current version on update', async () => {
      mockStorage['extension_version'] = '1.0.0';
      await checkVersion();
      expect(mockStorage['extension_version']).toBe('2.1.3');
    });
  });

  describe('dismissUpdateNotice', () => {
    it('sets dismissed flag in storage', async () => {
      await dismissUpdateNotice();
      expect(mockStorage['extension_update_dismissed']).toBe(true);
    });
  });

  describe('isUpdateDismissed', () => {
    it('returns false when not dismissed', async () => {
      const result = await isUpdateDismissed();
      expect(result).toBe(false);
    });

    it('returns true when dismissed', async () => {
      mockStorage['extension_update_dismissed'] = true;
      const result = await isUpdateDismissed();
      expect(result).toBe(true);
    });
  });
});
