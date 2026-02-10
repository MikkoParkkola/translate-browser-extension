/**
 * Logger utility unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLogger } from './logger';

describe('createLogger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an object with debug, info, warn, error methods', () => {
    const log = createLogger('TestModule');
    expect(typeof log.debug).toBe('function');
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
  });

  describe('debug', () => {
    it('logs with module prefix via console.log', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const log = createLogger('MyModule');
      log.debug('test message');
      expect(spy).toHaveBeenCalledWith('[MyModule]', 'test message');
    });

    it('passes extra arguments through', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const log = createLogger('Mod');
      log.debug('msg', 42, { key: 'val' });
      expect(spy).toHaveBeenCalledWith('[Mod]', 'msg', 42, { key: 'val' });
    });
  });

  describe('info', () => {
    it('logs with module prefix via console.log', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const log = createLogger('Info');
      log.info('info message');
      expect(spy).toHaveBeenCalledWith('[Info]', 'info message');
    });
  });

  describe('warn', () => {
    it('logs with module prefix via console.warn', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const log = createLogger('Warn');
      log.warn('warning');
      expect(spy).toHaveBeenCalledWith('[Warn]', 'warning');
    });

    it('passes extra arguments through', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const log = createLogger('W');
      log.warn('msg', new Error('test'));
      expect(spy).toHaveBeenCalledWith('[W]', 'msg', expect.any(Error));
    });
  });

  describe('error', () => {
    it('logs with module prefix via console.error', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const log = createLogger('Err');
      log.error('error message');
      expect(spy).toHaveBeenCalledWith('[Err]', 'error message');
    });

    it('passes extra arguments through', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const log = createLogger('E');
      log.error('failed', 'detail1', 'detail2');
      expect(spy).toHaveBeenCalledWith('[E]', 'failed', 'detail1', 'detail2');
    });
  });

  describe('module name handling', () => {
    it('uses empty module name', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const log = createLogger('');
      log.info('test');
      expect(spy).toHaveBeenCalledWith('[]', 'test');
    });

    it('uses module name with special characters', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const log = createLogger('My-Module.v2');
      log.info('test');
      expect(spy).toHaveBeenCalledWith('[My-Module.v2]', 'test');
    });
  });
});
