/**
 * OCR Service using Tesseract.js
 * Extracts text from images for translation
 */

import { createWorker, Worker, OEM } from 'tesseract.js';
import { createLogger } from './logger';

const log = createLogger('OCR');

let worker: Worker | null = null;
let isInitializing = false;
let initializationPromise: Promise<Worker> | null = null;

// Supported languages for OCR (ISO 639-3 codes for Tesseract)
// Maps common language codes to Tesseract language codes
const TESSERACT_LANG_MAP: Record<string, string> = {
  'en': 'eng',
  'fi': 'fin',
  'sv': 'swe',
  'de': 'deu',
  'fr': 'fra',
  'es': 'spa',
  'it': 'ita',
  'pt': 'por',
  'nl': 'nld',
  'pl': 'pol',
  'ru': 'rus',
  'ja': 'jpn',
  'zh': 'chi_sim',
  'ko': 'kor',
  'ar': 'ara',
};

// Default languages to load (can detect these without explicit selection)
const DEFAULT_LANGS = 'eng+fin+swe+deu+fra+spa';

/**
 * OCR extraction result
 */
export interface OCRResult {
  text: string;
  confidence: number;
  blocks: OCRBlock[];
}

/**
 * A text block with bounding box
 */
export interface OCRBlock {
  text: string;
  confidence: number;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
}

/**
 * Initialize Tesseract worker (lazy load with singleton pattern)
 */
async function getWorker(): Promise<Worker> {
  // Return existing worker if available
  if (worker) return worker;

  // Wait for ongoing initialization
  if (initializationPromise) {
    return initializationPromise;
  }

  // Start initialization
  isInitializing = true;
  initializationPromise = (async () => {
    try {
      log.info('Initializing Tesseract worker...');

      // Create worker with default languages
      const w = await createWorker(DEFAULT_LANGS, OEM.LSTM_ONLY, {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            log.debug(`Tesseract: ${m.status} ${Math.round((m.progress || 0) * 100)}%`);
          }
        },
      });

      worker = w;
      log.info('Tesseract worker ready');
      return w;
    } finally {
      isInitializing = false;
      initializationPromise = null;
    }
  })();

  return initializationPromise;
}

/**
 * Extract text from image URL or data URL
 *
 * @param imageSource - Image URL, data URL, or Blob
 * @param lang - Optional language hint (ISO 639-1 code like 'en', 'fi')
 * @returns Extracted text with confidence and block positions
 */
export async function extractTextFromImage(
  imageSource: string | Blob,
  lang?: string
): Promise<OCRResult> {
  const w = await getWorker();

  log.info('Extracting text from image...');
  const startTime = performance.now();

  try {
    // If specific language requested, reinitialize with that language
    if (lang && TESSERACT_LANG_MAP[lang]) {
      const tesseractLang = TESSERACT_LANG_MAP[lang];
      if (!DEFAULT_LANGS.includes(tesseractLang)) {
        log.info(`Loading additional language: ${tesseractLang}`);
        await w.reinitialize(tesseractLang);
      }
    }

    const result = await w.recognize(imageSource);

    const duration = performance.now() - startTime;
    log.info(`OCR completed in ${duration.toFixed(0)}ms, confidence: ${result.data.confidence.toFixed(1)}%`);

    // Extract blocks with their bounding boxes
    const blocks: OCRBlock[] = [];

    if (result.data.blocks) {
      for (const block of result.data.blocks) {
        const text = block.text.trim();
        if (text.length > 0) {
          blocks.push({
            text,
            confidence: block.confidence,
            bbox: {
              x0: block.bbox.x0,
              y0: block.bbox.y0,
              x1: block.bbox.x1,
              y1: block.bbox.y1,
            },
          });
        }
      }
    }

    // Fallback to paragraphs within blocks if no block-level text
    if (blocks.length === 0 && result.data.blocks) {
      for (const block of result.data.blocks) {
        if (block.paragraphs) {
          for (const para of block.paragraphs) {
            const text = para.text.trim();
            if (text.length > 0) {
              blocks.push({
                text,
                confidence: para.confidence,
                bbox: {
                  x0: para.bbox.x0,
                  y0: para.bbox.y0,
                  x1: para.bbox.x1,
                  y1: para.bbox.y1,
                },
              });
            }
          }
        }
      }
    }

    // Final fallback: use lines within paragraphs within blocks
    if (blocks.length === 0 && result.data.blocks) {
      for (const block of result.data.blocks) {
        if (block.paragraphs) {
          for (const para of block.paragraphs) {
            if (para.lines) {
              for (const line of para.lines) {
                const text = line.text.trim();
                if (text.length > 0) {
                  blocks.push({
                    text,
                    confidence: line.confidence,
                    bbox: {
                      x0: line.bbox.x0,
                      y0: line.bbox.y0,
                      x1: line.bbox.x1,
                      y1: line.bbox.y1,
                    },
                  });
                }
              }
            }
          }
        }
      }
    }

    return {
      text: result.data.text.trim(),
      confidence: result.data.confidence,
      blocks,
    };
  } catch (error) {
    const duration = performance.now() - startTime;
    log.error(`OCR failed after ${duration.toFixed(0)}ms:`, error);
    throw error;
  }
}

/**
 * Check if OCR worker is ready
 */
export function isOCRReady(): boolean {
  return worker !== null && !isInitializing;
}

/**
 * Check if OCR is currently initializing
 */
export function isOCRInitializing(): boolean {
  return isInitializing;
}

/**
 * Terminate worker (cleanup)
 * Note: Sets state to null BEFORE terminating to prevent race condition
 * with concurrent getWorker() calls during async termination
 */
export async function terminateOCR(): Promise<void> {
  if (worker || initializationPromise) {
    log.info('Terminating Tesseract worker...');

    // Clear state FIRST to prevent race conditions
    const workerToTerminate = worker;
    worker = null;
    initializationPromise = null;
    isInitializing = false;

    // Then terminate the actual worker
    if (workerToTerminate) {
      await workerToTerminate.terminate();
    }

    log.info('Tesseract worker terminated');
  }
}

/**
 * Get supported OCR languages
 */
export function getSupportedOCRLanguages(): string[] {
  return Object.keys(TESSERACT_LANG_MAP);
}
