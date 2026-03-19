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

    it('should trim whitespace from result text', async () => {
      const { createWorker } = await import('tesseract.js');
      vi.mocked(createWorker).mockResolvedValueOnce({
        recognize: vi.fn().mockResolvedValue({
          data: {
            text: '  hello world  ',
            confidence: 80,
            blocks: [],
          },
        }),
        terminate: vi.fn().mockResolvedValue(undefined),
        reinitialize: vi.fn().mockResolvedValue(undefined),
      } as ReturnType<typeof vi.fn>);

      const result = await extractTextFromImage('data:image/png;base64,abc123');
      expect(result.text).toBe('hello world');
    });

    it('should reinitialize worker when specific supported language is requested', async () => {
      const { createWorker } = await import('tesseract.js');
      const mockWorker = {
        recognize: vi.fn().mockResolvedValue({
          data: { text: 'Texto', confidence: 90, blocks: [] },
        }),
        terminate: vi.fn().mockResolvedValue(undefined),
        reinitialize: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(createWorker).mockResolvedValueOnce(mockWorker as ReturnType<typeof vi.fn>);

      // 'ru' maps to 'rus' which is NOT in DEFAULT_LANGS so reinitialize should be called
      await extractTextFromImage('data:image/png;base64,abc123', 'ru');

      expect(mockWorker.reinitialize).toHaveBeenCalledWith('rus');
    });

    it('should skip reinitialize when language is already in DEFAULT_LANGS', async () => {
      const { createWorker } = await import('tesseract.js');
      const mockWorker = {
        recognize: vi.fn().mockResolvedValue({
          data: { text: 'Hello', confidence: 92, blocks: [] },
        }),
        terminate: vi.fn().mockResolvedValue(undefined),
        reinitialize: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(createWorker).mockResolvedValueOnce(mockWorker as ReturnType<typeof vi.fn>);

      // 'en' maps to 'eng' which IS in DEFAULT_LANGS — reinitialize should NOT be called
      await extractTextFromImage('data:image/png;base64,abc123', 'en');

      expect(mockWorker.reinitialize).not.toHaveBeenCalled();
    });

    it('should skip reinitialize for unsupported language codes', async () => {
      const { createWorker } = await import('tesseract.js');
      const mockWorker = {
        recognize: vi.fn().mockResolvedValue({
          data: { text: 'Text', confidence: 85, blocks: [] },
        }),
        terminate: vi.fn().mockResolvedValue(undefined),
        reinitialize: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(createWorker).mockResolvedValueOnce(mockWorker as ReturnType<typeof vi.fn>);

      // 'xx' has no mapping in TESSERACT_LANG_MAP — reinitialize should NOT be called
      await extractTextFromImage('data:image/png;base64,abc123', 'xx');

      expect(mockWorker.reinitialize).not.toHaveBeenCalled();
    });

    it('should throw and propagate error when recognize fails', async () => {
      const { createWorker } = await import('tesseract.js');
      vi.mocked(createWorker).mockResolvedValueOnce({
        recognize: vi.fn().mockRejectedValue(new Error('Tesseract recognize failed')),
        terminate: vi.fn().mockResolvedValue(undefined),
        reinitialize: vi.fn().mockResolvedValue(undefined),
      } as ReturnType<typeof vi.fn>);

      await expect(
        extractTextFromImage('data:image/png;base64,bad')
      ).rejects.toThrow('Tesseract recognize failed');
    });

    it('should fall back to paragraphs when block text is empty', async () => {
      const { createWorker } = await import('tesseract.js');
      vi.mocked(createWorker).mockResolvedValueOnce({
        recognize: vi.fn().mockResolvedValue({
          data: {
            text: 'Para text',
            confidence: 70,
            blocks: [
              {
                text: '',  // empty block-level text
                confidence: 70,
                bbox: { x0: 0, y0: 0, x1: 200, y1: 100 },
                paragraphs: [
                  {
                    text: 'Paragraph content',
                    confidence: 70,
                    bbox: { x0: 0, y0: 0, x1: 200, y1: 50 },
                  },
                ],
              },
            ],
          },
        }),
        terminate: vi.fn().mockResolvedValue(undefined),
        reinitialize: vi.fn().mockResolvedValue(undefined),
      } as ReturnType<typeof vi.fn>);

      const result = await extractTextFromImage('data:image/png;base64,abc123');

      // blocks should come from paragraph fallback
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].text).toBe('Paragraph content');
    });

    it('should fall back to lines when both block and paragraph text are empty', async () => {
      const { createWorker } = await import('tesseract.js');
      vi.mocked(createWorker).mockResolvedValueOnce({
        recognize: vi.fn().mockResolvedValue({
          data: {
            text: 'Line text',
            confidence: 65,
            blocks: [
              {
                text: '',  // empty
                confidence: 65,
                bbox: { x0: 0, y0: 0, x1: 200, y1: 100 },
                paragraphs: [
                  {
                    text: '',  // also empty
                    confidence: 65,
                    bbox: { x0: 0, y0: 0, x1: 200, y1: 50 },
                    lines: [
                      {
                        text: 'Line content',
                        confidence: 65,
                        bbox: { x0: 0, y0: 0, x1: 200, y1: 25 },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        }),
        terminate: vi.fn().mockResolvedValue(undefined),
        reinitialize: vi.fn().mockResolvedValue(undefined),
      } as ReturnType<typeof vi.fn>);

      const result = await extractTextFromImage('data:image/png;base64,abc123');

      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].text).toBe('Line content');
    });

    it('should skip whitespace-only blocks', async () => {
      const { createWorker } = await import('tesseract.js');
      vi.mocked(createWorker).mockResolvedValueOnce({
        recognize: vi.fn().mockResolvedValue({
          data: {
            text: 'Real text',
            confidence: 88,
            blocks: [
              {
                text: '   ',  // whitespace only — should be trimmed and skipped
                confidence: 88,
                bbox: { x0: 0, y0: 0, x1: 100, y1: 50 },
              },
              {
                text: 'Real block',
                confidence: 88,
                bbox: { x0: 0, y0: 60, x1: 100, y1: 100 },
              },
            ],
          },
        }),
        terminate: vi.fn().mockResolvedValue(undefined),
        reinitialize: vi.fn().mockResolvedValue(undefined),
      } as ReturnType<typeof vi.fn>);

      const result = await extractTextFromImage('data:image/png;base64,abc123');

      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].text).toBe('Real block');
    });

    it('should handle image as Blob', async () => {
      const blob = new Blob(['fake image data'], { type: 'image/png' });
      const result = await extractTextFromImage(blob);

      expect(result).toBeDefined();
      expect(result.text).toBeDefined();
    });

    it('should return empty blocks array when no blocks in result', async () => {
      const { createWorker } = await import('tesseract.js');
      vi.mocked(createWorker).mockResolvedValueOnce({
        recognize: vi.fn().mockResolvedValue({
          data: {
            text: 'Some text',
            confidence: 60,
            blocks: null,
          },
        }),
        terminate: vi.fn().mockResolvedValue(undefined),
        reinitialize: vi.fn().mockResolvedValue(undefined),
      } as ReturnType<typeof vi.fn>);

      const result = await extractTextFromImage('data:image/png;base64,abc123');
      expect(result.blocks).toEqual([]);
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

    it('should handle termination when initializationPromise is set but worker is null', async () => {
      // Simulate state where initializationPromise is in flight but worker not yet assigned
      // We test this by calling terminateOCR while initialization is pending
      const { createWorker } = await import('tesseract.js');

      let resolveWorker!: (w: ReturnType<typeof vi.fn>) => void;
      const workerPromise = new Promise<ReturnType<typeof vi.fn>>((res) => {
        resolveWorker = res;
      });

      vi.mocked(createWorker).mockReturnValueOnce(workerPromise as ReturnType<typeof vi.fn>);

      // Start extraction (but don't await — leaves initializationPromise set)
      const extractionPromise = extractTextFromImage('data:image/png;base64,abc123');

      // Terminate before worker is ready
      await terminateOCR();

      expect(isOCRReady()).toBe(false);
      expect(isOCRInitializing()).toBe(false);

      // Resolve the worker so extractionPromise doesn't hang the suite
      const mockWorker = {
        recognize: vi.fn().mockResolvedValue({ data: { text: '', confidence: 0, blocks: [] } }),
        terminate: vi.fn().mockResolvedValue(undefined),
        reinitialize: vi.fn().mockResolvedValue(undefined),
      };
      resolveWorker(mockWorker as ReturnType<typeof vi.fn>);
      await extractionPromise.catch(() => undefined);
    });
  });

  describe('isOCRReady', () => {
    it('returns false before any extraction', () => {
      expect(isOCRReady()).toBe(false);
    });

    it('returns true after worker is initialized', async () => {
      await extractTextFromImage('data:image/png;base64,abc123');
      expect(isOCRReady()).toBe(true);
    });

    it('returns false after terminate', async () => {
      await extractTextFromImage('data:image/png;base64,abc123');
      await terminateOCR();
      expect(isOCRReady()).toBe(false);
    });
  });

  describe('isOCRInitializing', () => {
    it('returns false when not initializing', () => {
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

    it('should include all major language codes', () => {
      const languages = getSupportedOCRLanguages();
      const expected = ['en', 'fi', 'sv', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'ja', 'zh', 'ko', 'ar'];
      for (const lang of expected) {
        expect(languages).toContain(lang);
      }
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
