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
import { createLogger } from './logger';
import { browserAPI } from './browser-api';
import {
  canonicalizeLegacyTranslationProviderId,
  isTranslationProviderId,
} from '../shared/provider-options';

const log = createLogger('SiteRules');

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

interface PersistedSiteRules extends Omit<SiteRules, 'preferredProvider'> {
  preferredProvider?: string;
}

interface PersistedSiteRulesStore {
  [hostname: string]: PersistedSiteRules;
}

const STORAGE_KEY = 'siteRules';

function normalizeSiteRule(rule: PersistedSiteRules): SiteRules {
  const preferredProvider = rule.preferredProvider
    ? canonicalizeLegacyTranslationProviderId(rule.preferredProvider)
    : rule.preferredProvider;

  return {
    autoTranslate: rule.autoTranslate,
    sourceLang: rule.sourceLang,
    targetLang: rule.targetLang,
    strategy: rule.strategy,
    ...(preferredProvider && isTranslationProviderId(preferredProvider)
      ? { preferredProvider }
      : {}),
  };
}

function normalizeSiteRulesStore(rules: PersistedSiteRulesStore): SiteRulesStore {
  return Object.fromEntries(
    Object.entries(rules).map(([hostname, rule]) => [hostname, normalizeSiteRule(rule)])
  );
}

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
    const data = await browserAPI.storage.local.get(STORAGE_KEY);
    const allRules = normalizeSiteRulesStore((data[STORAGE_KEY] || {}) as PersistedSiteRulesStore);

    const match = findMatchingRule(hostname, allRules);
    return match ? match.rules : null;
  } catch (error) {
    log.error(' Failed to get rules:', error);
    return null;
  }
}

/**
 * Set site rules for a specific hostname or pattern
 */
export async function setRules(hostnameOrPattern: string, rules: SiteRules): Promise<void> {
  try {
    const data = await browserAPI.storage.local.get(STORAGE_KEY);
    const allRules = normalizeSiteRulesStore((data[STORAGE_KEY] || {}) as PersistedSiteRulesStore);

    allRules[hostnameOrPattern] = normalizeSiteRule(rules);

    await browserAPI.storage.local.set({ [STORAGE_KEY]: allRules });
    log.info(' Updated rules for:', hostnameOrPattern, rules);
  } catch (error) {
    log.error(' Failed to set rules:', error);
    throw error;
  }
}

/**
 * Clear site rules for a specific hostname or pattern
 */
export async function clearRules(hostnameOrPattern: string): Promise<void> {
  try {
    const data = await browserAPI.storage.local.get(STORAGE_KEY);
    const allRules = normalizeSiteRulesStore((data[STORAGE_KEY] || {}) as PersistedSiteRulesStore);

    delete allRules[hostnameOrPattern];

    await browserAPI.storage.local.set({ [STORAGE_KEY]: allRules });
    log.info(' Cleared rules for:', hostnameOrPattern);
  } catch (error) {
    log.error(' Failed to clear rules:', error);
    throw error;
  }
}

/**
 * Get all site rules
 */
export async function getAllRules(): Promise<SiteRulesStore> {
  try {
    const data = await browserAPI.storage.local.get(STORAGE_KEY);
    return normalizeSiteRulesStore((data[STORAGE_KEY] || {}) as PersistedSiteRulesStore);
  } catch (error) {
    log.error(' Failed to get all rules:', error);
    return {};
  }
}

/**
 * Clear all site rules
 */
export async function clearAllRules(): Promise<void> {
  try {
    await browserAPI.storage.local.remove(STORAGE_KEY);
    log.info(' Cleared all rules');
  } catch (error) {
    log.error(' Failed to clear all rules:', error);
    throw error;
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
    const imported: PersistedSiteRulesStore = JSON.parse(json);

    // Validate entry count to prevent storage quota exhaustion
    const MAX_IMPORT_ENTRIES = 10000;
    if (Object.keys(imported).length > MAX_IMPORT_ENTRIES) {
      throw new Error(`Import exceeds maximum of ${MAX_IMPORT_ENTRIES} entries`);
    }

    // Validate structure
    for (const [hostname, rules] of Object.entries(imported)) {
      /* v8 ignore start — Object.entries() always yields string keys */
      if (typeof hostname !== 'string') {
        /* v8 ignore start */
        throw new Error(`Invalid hostname: ${hostname}`);
        /* v8 ignore stop */
      }
      /* v8 ignore stop */
      if (typeof rules !== 'object' || rules === null) {
        throw new Error(`Invalid rules for ${hostname}`);
      }
      if (typeof rules.autoTranslate !== 'boolean') {
        throw new Error(`Invalid autoTranslate for ${hostname}`);
      }
    }

    const existing = await getAllRules();
    const merged = { ...existing, ...normalizeSiteRulesStore(imported) };

    await browserAPI.storage.local.set({ [STORAGE_KEY]: merged });
    log.info(' Imported', Object.keys(imported).length, 'rules');

    return Object.keys(imported).length;
  } catch (error) {
    log.error(' Failed to import rules:', error);
    throw error;
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
