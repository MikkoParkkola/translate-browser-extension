/**
 * ModelUpdater unit tests
 *
 * Tests for the ModelUpdater stub class.
 */

import { describe, it, expect, vi } from 'vitest';
import { ModelUpdater } from './ModelUpdater';

describe('ModelUpdater', () => {
  describe('constructor', () => {
    it('creates instance without arguments', () => {
      const updater = new ModelUpdater();
      expect(updater).toBeInstanceOf(ModelUpdater);
    });

    it('creates instance with registry and config', () => {
      const updater = new ModelUpdater({}, { checkInterval: 5000, autoUpdate: true });
      expect(updater).toBeInstanceOf(ModelUpdater);
    });
  });

  describe('checkForUpdates', () => {
    it('resolves with hasUpdate false', async () => {
      const updater = new ModelUpdater();
      const result = await updater.checkForUpdates();
      expect(result).toEqual({ hasUpdate: false });
    });
  });

  describe('scheduleUpdateCheck', () => {
    it('does not throw', () => {
      const updater = new ModelUpdater();
      expect(() => updater.scheduleUpdateCheck(60000)).not.toThrow();
    });

    it('accepts no arguments', () => {
      const updater = new ModelUpdater();
      expect(() => updater.scheduleUpdateCheck()).not.toThrow();
    });
  });

  describe('getUpdateInfo', () => {
    it('returns hasUpdate false', () => {
      const updater = new ModelUpdater();
      const info = updater.getUpdateInfo();
      expect(info).toEqual({ hasUpdate: false });
    });
  });

  describe('updateModelToVersion', () => {
    it('resolves without error for a version string', async () => {
      const updater = new ModelUpdater();
      await expect(updater.updateModelToVersion('v2.0')).resolves.toBeUndefined();
    });

    it('resolves with null version and callbacks', async () => {
      const updater = new ModelUpdater();
      const progressCb = vi.fn();
      const downloadFn = vi.fn();
      await expect(
        updater.updateModelToVersion(null, progressCb, downloadFn)
      ).resolves.toBeUndefined();
    });
  });

  describe('destroy', () => {
    it('does not throw', () => {
      const updater = new ModelUpdater();
      expect(() => updater.destroy()).not.toThrow();
    });
  });
});
