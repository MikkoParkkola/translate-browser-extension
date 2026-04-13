import { afterEach, describe, expect, it, vi } from 'vitest';

describe('createLogger', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('returns an object with debug, info, warn, error methods', async () => {
    vi.resetModules();

    const { createLogger } = await import('./logger');
    const logger = createLogger('TestModule');

    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('prefixes messages and forwards extra arguments', async () => {
    vi.stubEnv('VITE_LOG_LEVEL', 'debug');
    vi.resetModules();

    const { createLogger } = await import('./logger');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createLogger('My-Module.v2');

    logger.debug('debug', 42, { key: 'val' });
    logger.info('info');
    logger.warn('warn', new Error('test'));
    logger.error('error', 'detail');

    expect(logSpy).toHaveBeenCalledWith('[My-Module.v2]', 'debug', 42, { key: 'val' });
    expect(logSpy).toHaveBeenCalledWith('[My-Module.v2]', 'info');
    expect(warnSpy).toHaveBeenCalledWith('[My-Module.v2]', 'warn', expect.any(Error));
    expect(errorSpy).toHaveBeenCalledWith('[My-Module.v2]', 'error', 'detail');
  });

  it('supports empty module names', async () => {
    vi.stubEnv('VITE_LOG_LEVEL', 'info');
    vi.resetModules();

    const { createLogger } = await import('./logger');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createLogger('');

    logger.info('test');

    expect(logSpy).toHaveBeenCalledWith('[]', 'test');
  });

  it('logs all levels when debug logging is enabled', async () => {
    vi.stubEnv('VITE_LOG_LEVEL', 'debug');
    vi.resetModules();

    const { createLogger } = await import('./logger');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createLogger('Test');

    logger.debug('debug', 1);
    logger.info('info', 2);
    logger.warn('warn', 3);
    logger.error('error', 4);

    expect(logSpy).toHaveBeenCalledWith('[Test]', 'debug', 1);
    expect(logSpy).toHaveBeenCalledWith('[Test]', 'info', 2);
    expect(warnSpy).toHaveBeenCalledWith('[Test]', 'warn', 3);
    expect(errorSpy).toHaveBeenCalledWith('[Test]', 'error', 4);
  });

  it('suppresses debug/info when warn logging is enabled', async () => {
    vi.stubEnv('VITE_LOG_LEVEL', 'warn');
    vi.resetModules();

    const { createLogger } = await import('./logger');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createLogger('Test');

    logger.debug('debug');
    logger.info('info');
    logger.warn('warn');
    logger.error('error');

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith('[Test]', 'warn');
    expect(errorSpy).toHaveBeenCalledWith('[Test]', 'error');
  });

  it('falls back to production info level when env level is invalid', async () => {
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_LOG_LEVEL', 'invalid');
    vi.resetModules();

    const { createLogger } = await import('./logger');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logger = createLogger('Prod');

    logger.debug('debug');
    logger.info('info');
    logger.warn('warn');

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith('[Prod]', 'info');
    expect(warnSpy).toHaveBeenCalledWith('[Prod]', 'warn');
  });
});
