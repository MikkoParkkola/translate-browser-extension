/**
 * Tests for OCR service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Tesseract.js
vi.mock('tesseract.js', () => ({
  createWorker: vi.fn().mockResolvedValue({
    recognize: vi.fn().mockResolvedValue({
      data: {
        text: 'Recognized text',
        confidence: 95,
        blocks: [
          {
            text: 'Block 1',
            confidence: 95,
            bbox: { x0: 0, y0: 0, x1: 100, y1: 50 },
          },
        ],
      },
    }),
    terminate: vi.fn().mockResolvedValue(undefined),
    reinitialize: vi.fn().mockResolvedValue(undefined),
  }),
  OEM: {
    LSTM_ONLY: 1,
  },
}));

// Import after mocking
import {
  extractTextFromImage,
  terminateOCR,
  isOCRReady,
  isOCRInitializing,
  getSupportedOCRLanguages,
} from './ocr-service';

describe('OCR Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await terminateOCR();
  });

  describe('extractTextFromImage', () => {
    it('should extract text from image data URL', async () => {
      const result = await extractTextFromImage('data:image/png;base64,abc123');

      expect(result).toBeDefined();
      expect(result.text).toBe('Recognized text');
      expect(result.confidence).toBe(95);
      expect(result.blocks).toHaveLength(1);
    });

    it('should return blocks with bounding boxes', async () => {
      const result = await extractTextFromImage('data:image/png;base64,abc123');

      expect(result.blocks[0]).toEqual({
        text: 'Block 1',
        confidence: 95,
        bbox: { x0: 0, y0: 0, x1: 100, y1: 50 },
      });
    });
  });

  describe('terminateOCR', () => {
    it('should safely terminate when no worker exists', async () => {
      // Should not throw
      await expect(terminateOCR()).resolves.toBeUndefined();
    });

    it('should clear state before terminating to prevent race conditions', async () => {
      // Initialize worker first
      await extractTextFromImage('data:image/png;base64,abc123');

      // Terminate
      await terminateOCR();

      // State should be cleared
      expect(isOCRReady()).toBe(false);
      expect(isOCRInitializing()).toBe(false);
    });
  });

  describe('getSupportedOCRLanguages', () => {
    it('should return array of supported language codes', () => {
      const languages = getSupportedOCRLanguages();

      expect(Array.isArray(languages)).toBe(true);
      expect(languages.length).toBeGreaterThan(0);
      expect(languages).toContain('en');
      expect(languages).toContain('fi');
    });
  });

  describe('Singleton Pattern', () => {
    it('should reuse worker on subsequent calls', async () => {
      const { createWorker } = await import('tesseract.js');

      await extractTextFromImage('data:image/png;base64,abc123');
      await extractTextFromImage('data:image/png;base64,def456');

      // Worker should only be created once
      expect(createWorker).toHaveBeenCalledTimes(1);
    });
  });
});
