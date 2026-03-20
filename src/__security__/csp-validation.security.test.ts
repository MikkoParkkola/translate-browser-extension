/**
 * Content Security Policy Validation Tests
 *
 * Validates the CSP declared in manifest.json is properly formatted and
 * enforces expected restrictions against common attack vectors.
 */

import { describe, it, expect } from 'vitest';
import manifest from '../manifest.json';

// ── Extract CSP from manifest ──
const CSP_STRING =
  (manifest as Record<string, unknown> & {
    content_security_policy?: { extension_pages?: string };
  }).content_security_policy?.extension_pages ?? '';

// ── Helper: parse a CSP string into directive map ──
function parseCSP(csp: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of csp.split(';').map((s) => s.trim()).filter(Boolean)) {
    const [directive, ...values] = part.split(/\s+/);
    directives.set(directive, values);
  }
  return directives;
}

const directives = parseCSP(CSP_STRING);

describe('Content Security Policy', () => {
  describe('CSP string format', () => {
    it('CSP string exists and is non-empty', () => {
      expect(CSP_STRING.length).toBeGreaterThan(0);
    });

    it('CSP contains required directives', () => {
      expect(directives.has('script-src')).toBe(true);
      expect(directives.has('object-src')).toBe(true);
      expect(directives.has('connect-src')).toBe(true);
    });

    it('CSP is valid semicolon-delimited format', () => {
      const parts = CSP_STRING.split(';').map((s) => s.trim()).filter(Boolean);
      expect(parts.length).toBeGreaterThanOrEqual(3);
      for (const part of parts) {
        // Each directive should have at least a name and one value
        const tokens = part.split(/\s+/);
        expect(tokens.length).toBeGreaterThanOrEqual(2);
        // Directive name must end with -src
        expect(tokens[0]).toMatch(/-src$/);
      }
    });
  });

  describe('blocks dangerous patterns', () => {
    it("blocks inline scripts ('unsafe-inline' absent from script-src)", () => {
      const scriptSrc = directives.get('script-src') ?? [];
      expect(scriptSrc).not.toContain("'unsafe-inline'");
    });

    it("blocks eval() ('unsafe-eval' absent from script-src)", () => {
      const scriptSrc = directives.get('script-src') ?? [];
      expect(scriptSrc).not.toContain("'unsafe-eval'");
    });

    it('blocks external scripts from unauthorized domains', () => {
      const scriptSrc = directives.get('script-src') ?? [];
      // Only 'self' and 'wasm-unsafe-eval' should be allowed
      for (const value of scriptSrc) {
        expect(value).toMatch(/^'(self|wasm-unsafe-eval)'$/);
      }
    });

    it('blocks object/embed elements from external sources', () => {
      const objectSrc = directives.get('object-src') ?? [];
      // Only 'self' should be allowed
      expect(objectSrc).toEqual(["'self'"]);
    });

    it('connect-src does not allow wildcard (*)', () => {
      const connectSrc = directives.get('connect-src') ?? [];
      // No bare wildcard — only scoped wildcards like *.xethub.hf.co
      const bareWildcard = connectSrc.some(
        (v) => v === '*' || v === 'https://*' || v === 'http://*'
      );
      expect(bareWildcard).toBe(false);
    });
  });

  describe('allows required functionality', () => {
    it("allows WASM execution via 'wasm-unsafe-eval'", () => {
      const scriptSrc = directives.get('script-src') ?? [];
      expect(scriptSrc).toContain("'wasm-unsafe-eval'");
    });

    it("allows extension's own scripts via 'self'", () => {
      const scriptSrc = directives.get('script-src') ?? [];
      expect(scriptSrc).toContain("'self'");
    });

    it('allows HuggingFace CDN for model downloads', () => {
      const connectSrc = directives.get('connect-src') ?? [];
      const hfDomains = [
        'https://cdn-lfs.huggingface.co',
        'https://huggingface.co',
        'https://hf.co',
      ];
      for (const domain of hfDomains) {
        expect(connectSrc).toContain(domain);
      }
    });

    it('allows authorized translation API domains', () => {
      const connectSrc = directives.get('connect-src') ?? [];
      const apiDomains = [
        'https://api.deepl.com',
        'https://api-free.deepl.com',
        'https://api.openai.com',
        'https://generativelanguage.googleapis.com',
        'https://api.anthropic.com',
      ];
      for (const domain of apiDomains) {
        expect(connectSrc).toContain(domain);
      }
    });

    it('allows tessdata CDN for OCR', () => {
      const connectSrc = directives.get('connect-src') ?? [];
      expect(connectSrc).toContain('https://tessdata.projectnaptha.com');
    });
  });
});
