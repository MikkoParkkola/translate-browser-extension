import { describe, expect, it } from 'vitest';

import {
  createTypeMessageGuard,
  hasStringMessageType,
  isLiteralValue,
  isObjectRecord,
  isStringValue,
} from './message-guards';

describe('message-guards', () => {
  describe('isObjectRecord', () => {
    it('accepts plain objects and rejects nullish or primitive values', () => {
      expect(isObjectRecord({ type: 'ping' })).toBe(true);
      expect(isObjectRecord(null)).toBe(false);
      expect(isObjectRecord('ping')).toBe(false);
    });
  });

  describe('hasStringMessageType', () => {
    it('accepts objects with a string type field', () => {
      expect(hasStringMessageType({ type: 'ping' })).toBe(true);
    });

    it('rejects objects without a string type field', () => {
      expect(hasStringMessageType({})).toBe(false);
      expect(hasStringMessageType({ type: 123 })).toBe(false);
    });
  });

  describe('createTypeMessageGuard', () => {
    interface BackgroundTestMessage {
      type: 'backgroundTest';
      target: 'background';
      modelId: string;
    }

    const isBackgroundTestMessage = createTypeMessageGuard<BackgroundTestMessage>(
      'backgroundTest',
      {
        target: isLiteralValue('background'),
        modelId: isStringValue,
      }
    );

    it('accepts messages with the expected type and validated fields', () => {
      expect(
        isBackgroundTestMessage({
          type: 'backgroundTest',
          target: 'background',
          modelId: 'opus-mt-en-fi',
        })
      ).toBe(true);
    });

    it('rejects messages with the wrong type or invalid fields', () => {
      expect(
        isBackgroundTestMessage({
          type: 'backgroundTest',
          target: 'popup',
          modelId: 'opus-mt-en-fi',
        })
      ).toBe(false);

      expect(
        isBackgroundTestMessage({
          type: 'backgroundTest',
          target: 'background',
          modelId: 123,
        })
      ).toBe(false);

      expect(
        isBackgroundTestMessage({
          type: 'other',
          target: 'background',
          modelId: 'opus-mt-en-fi',
        })
      ).toBe(false);
    });
  });
});
