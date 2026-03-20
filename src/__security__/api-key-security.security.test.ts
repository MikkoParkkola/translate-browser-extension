/**
 * API Key Storage Security Tests
 *
 * Validates that API keys are stored securely:
 * - chrome.storage.local (not sync which goes to cloud)
 * - Content scripts cannot directly access background storage
 * - Keys are not exposed in logs or error messages
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Source file paths (relative to project root) ──
const SRC_ROOT = path.resolve(__dirname, '..');
const STORAGE_TS = path.join(SRC_ROOT, 'core', 'storage.ts');
const SERVICE_WORKER_TS = path.join(SRC_ROOT, 'background', 'service-worker.ts');
const CONTENT_INDEX_TS = path.join(SRC_ROOT, 'content', 'index.ts');

// Read sources once for static analysis
const storageSource = fs.readFileSync(STORAGE_TS, 'utf-8');
const serviceWorkerSource = fs.readFileSync(SERVICE_WORKER_TS, 'utf-8');
const contentSource = fs.readFileSync(CONTENT_INDEX_TS, 'utf-8');

// Provider key names as declared in service-worker.ts
const API_KEY_NAMES = [
  'deepl_api_key',
  'openai_api_key',
  'anthropic_api_key',
  'google_cloud_api_key',
];

describe('API Key Storage Security', () => {
  describe('storage backend — chrome.storage.local only', () => {
    it('storage module uses chrome.storage.local (not sync)', () => {
      expect(storageSource).toContain('storage.local.get');
      expect(storageSource).toContain('storage.local.set');
    });

    it('storage module never uses storage.sync', () => {
      expect(storageSource).not.toContain('storage.sync');
    });

    it('service worker never uses storage.sync for API keys', () => {
      // storage.sync would push keys to Google Cloud — must never be used
      expect(serviceWorkerSource).not.toContain('storage.sync');
    });

    it('no production source file uses storage.sync anywhere in the codebase', () => {
      const tsFiles = walkDir(SRC_ROOT, '.ts');
      const violations: string[] = [];
      for (const file of tsFiles) {
        const rel = path.relative(SRC_ROOT, file);
        // Skip test files — they may reference storage.sync in assertions
        if (rel.includes('__security__') || rel.includes('.test.')) continue;
        const content = fs.readFileSync(file, 'utf-8');
        if (content.includes('storage.sync')) {
          violations.push(rel);
        }
      }
      expect(violations).toEqual([]);
    });
  });

  describe('content script isolation', () => {
    it('content script does not directly call chrome.storage', () => {
      // Content scripts should use message passing, not direct storage access
      const hasDirectStorageAccess =
        contentSource.includes('chrome.storage.local.get') ||
        contentSource.includes('chrome.storage.local.set') ||
        contentSource.includes('browserAPI.storage.local.get') ||
        contentSource.includes('browserAPI.storage.local.set');
      expect(hasDirectStorageAccess).toBe(false);
    });

    it('content script does not reference API key storage keys', () => {
      // Content script may import storage for user settings (e.g., targetLang),
      // but must never reference API key storage keys directly.
      for (const keyName of API_KEY_NAMES) {
        expect(contentSource).not.toContain(keyName);
      }
    });
  });

  describe('API keys not leaked in logs or errors', () => {
    it('service worker error handler uses formatUserError (no raw keys in responses)', () => {
      // The onMessage handler wraps errors through formatUserError before
      // sending to the content script, ensuring API keys are never leaked.
      expect(serviceWorkerSource).toContain('formatUserError(translationError)');
    });

    it('storage module error messages do not include stored values', () => {
      // safeStorageGet error handler should log key names, not values
      expect(storageSource).toContain('keys');
      // Ensure the error messages reference keyStr (key names), not result values
      const errorLines = storageSource
        .split('\n')
        .filter((l) => l.includes('log.error'));
      for (const line of errorLines) {
        expect(line).toContain('keyStr');
        expect(line).not.toContain('result');
        expect(line).not.toContain('value');
      }
    });

    it('handleGetCloudProviderStatus returns boolean status, not key values', () => {
      // Extract the handler function source
      const handlerMatch = serviceWorkerSource.match(
        /async function handleGetCloudProviderStatus[\s\S]*?^}/m
      );
      expect(handlerMatch).not.toBeNull();
      const handler = handlerMatch![0];
      // It should convert to boolean (!!stored[key]), not return raw key
      expect(handler).toContain('!!stored');
    });
  });

  describe('message handler security', () => {
    it('message handler ignores messages with offscreen target', () => {
      // Verify the guard clause exists
      expect(serviceWorkerSource).toContain(
        "'target' in message && message.target === 'offscreen'"
      );
    });

    it('setCloudApiKey handler validates provider name against allow-list', () => {
      // The handler looks up CLOUD_PROVIDER_KEYS[provider] and returns an
      // error if the provider is unknown, preventing arbitrary storage writes.
      expect(serviceWorkerSource).toContain('CLOUD_PROVIDER_KEYS[message.provider]');
      // It also checks for a missing key and returns early
      expect(serviceWorkerSource).toContain("if (!storageKey)");
    });
  });
});

// ── Utility ──
function walkDir(dir: string, ext: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        results.push(...walkDir(full, ext));
      } else if (entry.isFile() && entry.name.endsWith(ext)) {
        results.push(full);
      }
    }
  } catch {
    // skip unreadable dirs
  }
  return results;
}
