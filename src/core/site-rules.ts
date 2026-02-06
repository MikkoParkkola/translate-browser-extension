/**
 * Per-site translation rules
 * Stores and retrieves site-specific translation preferences
 *
 * Features:
 * - Per-hostname preferences (auto-translate, provider, languages)
 * - Wildcard matching (*.example.com)
 * - Persistent storage via chrome.storage.local
 */

import type { TranslationProviderId, Strategy } from '../types';

export interface SiteRules {
  autoTranslate: boolean;
  preferredProvider?: TranslationProviderId;
  sourceLang?: string;
  targetLang?: string;
  strategy?: Strategy;
}

export interface SiteRulesStore {
  [hostname: string]: SiteRules;
}

const STORAGE_KEY = 'siteRules';

/**
 * Check if hostname matches a wildcard pattern
 * Supports patterns like *.example.com
 */
export function matchesPattern(hostname: string, pattern: string): boolean {
  if (pattern === hostname) {
    return true;
  }

  // Handle wildcard patterns
  if (pattern.startsWith('*.')) {
    const baseDomain = pattern.slice(2);
    // Match exact domain or any subdomain
    return hostname === baseDomain || hostname.endsWith('.' + baseDomain);
  }

  return false;
}

/**
 * Find the best matching rule for a hostname
 * Exact matches take precedence over wildcard matches
 */
export function findMatchingRule(
  hostname: string,
  rules: SiteRulesStore
): { pattern: string; rules: SiteRules } | null {
  // First check for exact match
  if (rules[hostname]) {
    return { pattern: hostname, rules: rules[hostname] };
  }

  // Then check wildcard patterns (sorted by specificity)
  const wildcardPatterns = Object.keys(rules)
    .filter((pattern) => pattern.startsWith('*.'))
    .sort((a, b) => b.length - a.length); // More specific patterns first

  for (const pattern of wildcardPatterns) {
    if (matchesPattern(hostname, pattern)) {
      return { pattern, rules: rules[pattern] };
    }
  }

  return null;
}

/**
 * Get site rules for a hostname
 * Returns matching rules considering wildcard patterns
 */
export async function getRules(hostname: string): Promise<SiteRules | null> {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const allRules: SiteRulesStore = data[STORAGE_KEY] || {};

    const match = findMatchingRule(hostname, allRules);
    return match ? match.rules : null;
  } catch (e) {
    console.error('[SiteRules] Failed to get rules:', e);
    return null;
  }
}

/**
 * Set site rules for a specific hostname or pattern
 */
export async function setRules(hostnameOrPattern: string, rules: SiteRules): Promise<void> {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const allRules: SiteRulesStore = data[STORAGE_KEY] || {};

    allRules[hostnameOrPattern] = rules;

    await chrome.storage.local.set({ [STORAGE_KEY]: allRules });
    console.log('[SiteRules] Updated rules for:', hostnameOrPattern, rules);
  } catch (e) {
    console.error('[SiteRules] Failed to set rules:', e);
    throw e;
  }
}

/**
 * Clear site rules for a specific hostname or pattern
 */
export async function clearRules(hostnameOrPattern: string): Promise<void> {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const allRules: SiteRulesStore = data[STORAGE_KEY] || {};

    delete allRules[hostnameOrPattern];

    await chrome.storage.local.set({ [STORAGE_KEY]: allRules });
    console.log('[SiteRules] Cleared rules for:', hostnameOrPattern);
  } catch (e) {
    console.error('[SiteRules] Failed to clear rules:', e);
    throw e;
  }
}

/**
 * Get all site rules
 */
export async function getAllRules(): Promise<SiteRulesStore> {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    return data[STORAGE_KEY] || {};
  } catch (e) {
    console.error('[SiteRules] Failed to get all rules:', e);
    return {};
  }
}

/**
 * Clear all site rules
 */
export async function clearAllRules(): Promise<void> {
  try {
    await chrome.storage.local.remove(STORAGE_KEY);
    console.log('[SiteRules] Cleared all rules');
  } catch (e) {
    console.error('[SiteRules] Failed to clear all rules:', e);
    throw e;
  }
}

/**
 * Export rules as JSON string
 */
export async function exportRules(): Promise<string> {
  const rules = await getAllRules();
  return JSON.stringify(rules, null, 2);
}

/**
 * Import rules from JSON string
 * Merges with existing rules (imported rules take precedence)
 */
export async function importRules(json: string): Promise<number> {
  try {
    const imported: SiteRulesStore = JSON.parse(json);

    // Validate structure
    for (const [hostname, rules] of Object.entries(imported)) {
      if (typeof hostname !== 'string') {
        throw new Error(`Invalid hostname: ${hostname}`);
      }
      if (typeof rules !== 'object' || rules === null) {
        throw new Error(`Invalid rules for ${hostname}`);
      }
      if (typeof rules.autoTranslate !== 'boolean') {
        throw new Error(`Invalid autoTranslate for ${hostname}`);
      }
    }

    const existing = await getAllRules();
    const merged = { ...existing, ...imported };

    await chrome.storage.local.set({ [STORAGE_KEY]: merged });
    console.log('[SiteRules] Imported', Object.keys(imported).length, 'rules');

    return Object.keys(imported).length;
  } catch (e) {
    console.error('[SiteRules] Failed to import rules:', e);
    throw e;
  }
}

export const siteRules = {
  getRules,
  setRules,
  clearRules,
  getAllRules,
  clearAllRules,
  exportRules,
  importRules,
  matchesPattern,
  findMatchingRule,
};

export default siteRules;
