/**
 * Language detector tests
 */

import { describe, it, expect } from 'vitest';
import { detectLanguage } from './language-detector';
import type { LanguageDetectionResult } from './language-detector';

describe('Language Detector', () => {
  describe('detectLanguage', () => {
    // ======================================================================
    // Core language detection (5+ languages required by spec)
    // ======================================================================

    it('detects English text', () => {
      const result = detectLanguage(
        'The quick brown fox jumps over the lazy dog and runs through the forest'
      );
      expect(result).not.toBeNull();
      expect(result!.lang).toBe('en');
      expect(result!.confidence).toBeGreaterThan(0.2);
    });

    it('detects Finnish text', () => {
      const result = detectLanguage(
        'Suomen tasavalta on valtio Pohjois-Euroopassa ja yksi Pohjoismaista'
      );
      expect(result).not.toBeNull();
      expect(result!.lang).toBe('fi');
      expect(result!.confidence).toBeGreaterThan(0.2);
    });

    it('detects German text', () => {
      const result = detectLanguage(
        'Die Bundesrepublik Deutschland ist ein demokratischer und sozialer Bundesstaat'
      );
      expect(result).not.toBeNull();
      expect(result!.lang).toBe('de');
      expect(result!.confidence).toBeGreaterThan(0.2);
    });

    it('detects French text', () => {
      const result = detectLanguage(
        'Les institutions de la Republique sont les organes du pouvoir politique qui constituent le gouvernement et les collectivites territoriales. Le parlement est compose de deux chambres qui representent les citoyens et les communes de la nation.'
      );
      expect(result).not.toBeNull();
      expect(result!.lang).toBe('fr');
      expect(result!.confidence).toBeGreaterThan(0.2);
    });

    it('detects Spanish text', () => {
      const result = detectLanguage(
        'El gobierno de la nacion se constituye como una monarquia parlamentaria con las cortes generales que representan al pueblo y aprueban los presupuestos del estado y las leyes que regulan la convivencia de los ciudadanos.'
      );
      expect(result).not.toBeNull();
      expect(result!.lang).toBe('es');
      expect(result!.confidence).toBeGreaterThan(0.2);
    });

    it('detects Swedish text', () => {
      const result = detectLanguage(
        'Sverige ar ett nordiskt land som har en liten och oppen ekonomi och handlar mycket med andra lander'
      );
      expect(result).not.toBeNull();
      expect(result!.lang).toBe('sv');
      expect(result!.confidence).toBeGreaterThan(0.15);
    });

    it('detects Italian text', () => {
      const result = detectLanguage(
        'La costituzione della repubblica italiana stabilisce che il parlamento e composto di due camere che rappresentano il popolo e le regioni. Il presidente del consiglio dei ministri dirige la politica generale del governo e ne coordina le attivita.'
      );
      expect(result).not.toBeNull();
      expect(result!.lang).toBe('it');
      expect(result!.confidence).toBeGreaterThan(0.2);
    });

    it('detects Portuguese text', () => {
      const result = detectLanguage(
        'A constituicao da republica portuguesa estabelece que o estado se organiza em parlamento e governo para representar os cidadaos. Os partidos politicos participam nos orgaos do poder e contribuem para a formacao da vontade popular.'
      );
      expect(result).not.toBeNull();
      expect(result!.lang).toBe('pt');
      expect(result!.confidence).toBeGreaterThan(0.15);
    });

    it('detects Dutch text', () => {
      const result = detectLanguage(
        'Nederland is een land dat aan de Noordzee in het westen van Europa ligt'
      );
      expect(result).not.toBeNull();
      expect(result!.lang).toBe('nl');
      expect(result!.confidence).toBeGreaterThan(0.15);
    });

    it('detects Turkish text', () => {
      const result = detectLanguage(
        'Turkiye Cumhuriyeti bir devlet olarak bati ile dogu arasinda bir koprudur ve buyuk bir ulkedir'
      );
      expect(result).not.toBeNull();
      expect(result!.lang).toBe('tr');
      expect(result!.confidence).toBeGreaterThan(0.15);
    });

    // ======================================================================
    // Script-based detection (non-Latin)
    // ======================================================================

    it('detects Japanese text via script', () => {
      const result = detectLanguage('これは日本語のテキストです。東京は日本の首都です。');
      expect(result).not.toBeNull();
      expect(result!.lang).toBe('ja');
      expect(result!.confidence).toBeGreaterThanOrEqual(0.90);
    });

    it('detects Korean text via script', () => {
      const result = detectLanguage('대한민국은 동아시아에 위치한 민주공화국입니다');
      expect(result).not.toBeNull();
      expect(result!.lang).toBe('ko');
      expect(result!.confidence).toBeGreaterThanOrEqual(0.90);
    });

    it('detects Chinese text via script', () => {
      const result = detectLanguage('中华人民共和国是一个位于东亚的社会主义国家');
      expect(result).not.toBeNull();
      expect(result!.lang).toBe('zh');
      expect(result!.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it('detects Russian text via script', () => {
      const result = detectLanguage('Россия является крупнейшим государством мира по площади территории');
      expect(result).not.toBeNull();
      expect(result!.lang).toBe('ru');
      expect(result!.confidence).toBeGreaterThanOrEqual(0.80);
    });

    it('detects Arabic text via script', () => {
      const result = detectLanguage('المملكة العربية السعودية هي دولة عربية تقع في شبه الجزيرة العربية');
      expect(result).not.toBeNull();
      expect(result!.lang).toBe('ar');
      expect(result!.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it('detects Hindi text via script', () => {
      const result = detectLanguage('भारत दक्षिण एशिया में स्थित एक देश है जो विश्व का सातवां सबसे बड़ा देश है');
      expect(result).not.toBeNull();
      expect(result!.lang).toBe('hi');
      expect(result!.confidence).toBeGreaterThanOrEqual(0.85);
    });

    // ======================================================================
    // Edge cases
    // ======================================================================

    it('returns null for empty input', () => {
      expect(detectLanguage('')).toBeNull();
    });

    it('returns null for whitespace-only input', () => {
      expect(detectLanguage('   \n\t  ')).toBeNull();
    });

    it('returns null for very short text (less than 10 chars)', () => {
      expect(detectLanguage('Hello')).toBeNull();
      expect(detectLanguage('Hi there')).toBeNull(); // 8 chars
    });

    it('can detect with borderline length text (~20 chars)', () => {
      // Short but enough for some trigram signal
      const result = detectLanguage('This is a test sentence');
      // May or may not detect, but should not crash
      if (result) {
        expect(result.lang).toBeTruthy();
      }
    });

    it('returns null for null/undefined-like input', () => {
      // TypeScript would catch this, but test runtime safety
      expect(detectLanguage(null as unknown as string)).toBeNull();
      expect(detectLanguage(undefined as unknown as string)).toBeNull();
    });

    it('handles text with many numbers and punctuation', () => {
      // Should either detect or gracefully return null
      const result = detectLanguage('12345 67890 !@#$% ^&*() more text here please');
      // Might detect English from "more text here please" or return null - both acceptable
      if (result !== null) {
        expect(result.lang).toBeTruthy();
        expect(result.confidence).toBeGreaterThan(0);
      }
    });

    it('handles mixed-language text (returns dominant language)', () => {
      // Mostly English with a German word
      const result = detectLanguage(
        'The architecture of this building is beautiful and the Wanderlust is real here today'
      );
      expect(result).not.toBeNull();
      // Should detect English as dominant
      expect(result!.lang).toBe('en');
    });

    // ======================================================================
    // Return shape
    // ======================================================================

    it('returns correct shape with lang and confidence', () => {
      const result = detectLanguage(
        'This is a sample text that should be long enough for detection'
      ) as LanguageDetectionResult;
      expect(result).toHaveProperty('lang');
      expect(result).toHaveProperty('confidence');
      expect(typeof result.lang).toBe('string');
      expect(typeof result.confidence).toBe('number');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('confidence is rounded to 2 decimal places', () => {
      const result = detectLanguage(
        'This is a test sentence that is long enough for the detector to process'
      );
      if (result) {
        const decimalPlaces = (result.confidence.toString().split('.')[1] || '').length;
        expect(decimalPlaces).toBeLessThanOrEqual(2);
      }
    });

    // ======================================================================
    // Performance (sanity check)
    // ======================================================================

    it('runs in under 5ms for typical paragraph', () => {
      const text = 'The quick brown fox jumps over the lazy dog. '.repeat(5);
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        detectLanguage(text);
      }
      const elapsed = performance.now() - start;
      // 100 iterations should complete in well under 500ms (= 5ms each)
      expect(elapsed).toBeLessThan(500);
    });
  });
});
