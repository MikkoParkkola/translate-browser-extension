import { describe, it, expect } from 'vitest';
import { logger } from './logger';

describe('logger', () => {
  const methods = ['info', 'warn', 'error', 'debug'] as const;

  for (const method of methods) {
    it(`${method} is a function`, () => {
      expect(typeof logger[method]).toBe('function');
    });

    it(`${method} does not throw with no arguments`, () => {
      expect(() => logger[method]()).not.toThrow();
    });

    it(`${method} does not throw with various argument types`, () => {
      expect(() => logger[method]('string')).not.toThrow();
      expect(() => logger[method](42)).not.toThrow();
      expect(() => logger[method]({ key: 'value' })).not.toThrow();
      expect(() => logger[method](null, undefined, true)).not.toThrow();
      expect(() => logger[method]('msg', new Error('err'))).not.toThrow();
    });
  }
});
