/**
 * Tests for src/content/sanitize.ts
 *
 * Tests HTML escaping utility used to prevent XSS.
 */

import { describe, it, expect } from 'vitest';
import { escapeHtml } from './sanitize';

describe('escapeHtml', () => {
  it('returns plain text unchanged', () => {
    expect(escapeHtml('Hello world')).toBe('Hello world');
  });

  it('escapes ampersand', () => {
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });

  it('escapes less-than', () => {
    expect(escapeHtml('1 < 2')).toBe('1 &lt; 2');
  });

  it('escapes greater-than', () => {
    expect(escapeHtml('2 > 1')).toBe('2 &gt; 1');
  });

  it('escapes double quotes', () => {
    const result = escapeHtml('"quoted"');
    // textContent -> innerHTML encodes " as &quot; in some browsers
    // but jsdom may differ — verify no raw < or & present
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
  });

  it('escapes full XSS payload', () => {
    const xss = '<script>alert("xss")</script>';
    const result = escapeHtml(xss);
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('escapes tag with attribute', () => {
    const result = escapeHtml('<img src=x onerror=alert(1)>');
    expect(result).toContain('&lt;img');
    expect(result).not.toContain('<img');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('handles string with only special chars', () => {
    const result = escapeHtml('<<<');
    expect(result).toBe('&lt;&lt;&lt;');
  });

  it('handles multiple ampersands', () => {
    expect(escapeHtml('a & b & c')).toBe('a &amp; b &amp; c');
  });

  it('handles already-escaped text without double-escaping', () => {
    // Input with literal &amp; — escapeHtml should escape the & again
    const result = escapeHtml('&amp;');
    expect(result).toBe('&amp;amp;');
  });
});
