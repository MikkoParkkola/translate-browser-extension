/**
 * @fileoverview Secure storage wrapper for sensitive data like API keys
 * Provides encryption and secure key management for Chrome extension storage
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.qwenSecureStorage = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  // Initialize dependencies
  const security = (typeof self !== 'undefined' && self.qwenSecurity) ||
                   (typeof require !== 'undefined' ? require('./security') : null);
  const logger = (typeof self !== 'undefined' && self.qwenLogger?.create) 
    ? self.qwenLogger.create('secure-storage')
    : console;

  /**
   * Simple encryption utilities using Web Crypto API
   */
  class EncryptionManager {
    constructor() {
      this.keyCache = new Map();
      this.algorithm = { name: 'AES-GCM', length: 256 };
    }

    /**
     * Generate or retrieve encryption key
     */
    async getOrCreateKey(keyId) {
      if (this.keyCache.has(keyId)) {
        return this.keyCache.get(keyId);
      }

      let keyData;
      try {
        // Try to load existing key from storage
        const stored = await this._getFromStorage(`_key_${keyId}`);
        if (stored && stored.keyData) {
          keyData = new Uint8Array(stored.keyData);
        }
      } catch (error) {
        logger.debug('No existing key found, generating new one');
      }

      if (!keyData) {
        // Generate new key
        const cryptoKey = await crypto.subtle.generateKey(
          this.algorithm,
          true,
          ['encrypt', 'decrypt']
        );
        
        const exported = await crypto.subtle.exportKey('raw', cryptoKey);
        keyData = new Uint8Array(exported);
        
        // Store key securely
        await this._setInStorage(`_key_${keyId}`, {
          keyData: Array.from(keyData),
          created: Date.now()
        });
      }

      // Import key for use
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        this.algorithm,
        false,
        ['encrypt', 'decrypt']
      );

      this.keyCache.set(keyId, cryptoKey);
      return cryptoKey;
    }

    /**
     * Encrypt data using AES-GCM
     */
    async encrypt(data, keyId = 'default') {
      const key = await this.getOrCreateKey(keyId);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encoder = new TextEncoder();
      const encodedData = encoder.encode(JSON.stringify(data));

      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encodedData
      );

      return {
        iv: Array.from(iv),
        data: Array.from(new Uint8Array(encrypted)),
        keyId
      };
    }

    /**
     * Decrypt data using AES-GCM
     */
    async decrypt(encryptedData) {
      const { iv, data, keyId = 'default' } = encryptedData;
      const key = await this.getOrCreateKey(keyId);

      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(iv) },
        key,
        new Uint8Array(data)
      );

      const decoder = new TextDecoder();
      const decryptedText = decoder.decode(decrypted);
      return JSON.parse(decryptedText);
    }

    /**
     * Storage helpers
     */
    async _getFromStorage(key) {
      return new Promise((resolve) => {
        chrome.storage.local.get({ [key]: null }, (result) => {
          resolve(result[key]);
        });
      });
    }

    async _setInStorage(key, value) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [key]: value }, resolve);
      });
    }
  }

  /**
   * Secure storage manager for sensitive data
   */
  class SecureStorage {
    constructor() {
      this.encryption = new EncryptionManager();
      this.sensitiveKeys = new Set([
        'apiKey', 'detectApiKey', 'providers', 
        'auth_token', 'refresh_token', 'credentials'
      ]);
    }

    /**
     * Store sensitive data with encryption
     */
    async setSecure(key, value, options = {}) {
      if (!key || value === undefined) {
        throw new Error('Key and value are required');
      }

      // Sanitize the value using security module
      let sanitizedValue = value;
      if (security && this.sensitiveKeys.has(key)) {
        if (key.toLowerCase().includes('key') || key.toLowerCase().includes('token')) {
          sanitizedValue = security.sanitizeApiKey(value);
        } else if (key === 'providers' && typeof value === 'object') {
          sanitizedValue = security.sanitizeApiConfig(value);
        }
      }

      const encrypted = await this.encryption.encrypt(sanitizedValue);
      const storageKey = `_secure_${key}`;
      
      const metadata = {
        encrypted: true,
        created: Date.now(),
        lastAccessed: Date.now(),
        ttl: options.ttl || null,
        keyRotation: options.keyRotation || null
      };

      return new Promise((resolve, reject) => {
        chrome.storage.local.set({
          [storageKey]: encrypted,
          [`${storageKey}_meta`]: metadata
        }, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            if (security) {
              security.logSecurityEvent('secure_storage_set', {
                key: key,
                encrypted: true,
                ttl: options.ttl || 'none'
              });
            }
            resolve();
          }
        });
      });
    }

    /**
     * Retrieve and decrypt sensitive data
     */
    async getSecure(key) {
      const storageKey = `_secure_${key}`;
      
      return new Promise(async (resolve, reject) => {
        chrome.storage.local.get({
          [storageKey]: null,
          [`${storageKey}_meta`]: null
        }, async (result) => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }

          const encrypted = result[storageKey];
          const metadata = result[`${storageKey}_meta`];

          if (!encrypted) {
            return resolve(null);
          }

          // Check TTL expiration
          if (metadata && metadata.ttl && Date.now() > metadata.created + metadata.ttl) {
            await this.removeSecure(key);
            return resolve(null);
          }

          try {
            const decrypted = await this.encryption.decrypt(encrypted);
            
            // Update last accessed time
            if (metadata) {
              metadata.lastAccessed = Date.now();
              chrome.storage.local.set({ [`${storageKey}_meta`]: metadata });
            }

            resolve(decrypted);
          } catch (error) {
            logger.error('Failed to decrypt secure data:', error);
            reject(new Error('Failed to decrypt secure data'));
          }
        });
      });
    }

    /**
     * Remove secure data
     */
    async removeSecure(key) {
      const storageKey = `_secure_${key}`;
      
      return new Promise((resolve, reject) => {
        chrome.storage.local.remove([storageKey, `${storageKey}_meta`], () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            if (security) {
              security.logSecurityEvent('secure_storage_remove', { key });
            }
            resolve();
          }
        });
      });
    }

    /**
     * Migrate existing plaintext sensitive data to encrypted storage
     */
    async migrateSensitiveData() {
      const migrationPromises = [];

      for (const key of this.sensitiveKeys) {
        migrationPromises.push(this._migrateSingleKey(key));
      }

      // Also migrate provider configs
      migrationPromises.push(this._migrateProviders());

      const results = await Promise.allSettled(migrationPromises);
      const failedMigrations = results.filter(r => r.status === 'rejected');
      
      if (failedMigrations.length > 0) {
        logger.warn(`${failedMigrations.length} migrations failed`);
      }

      if (security) {
        security.logSecurityEvent('secure_storage_migration', {
          total: migrationPromises.length,
          failed: failedMigrations.length
        });
      }
    }

    async _migrateSingleKey(key) {
      return new Promise((resolve) => {
        chrome.storage.sync.get({ [key]: null }, async (result) => {
          const value = result[key];
          if (value && typeof value === 'string' && value.trim() !== '') {
            try {
              await this.setSecure(key, value);
              // Remove from sync storage after successful encryption
              chrome.storage.sync.remove([key]);
              logger.debug(`Migrated ${key} to secure storage`);
            } catch (error) {
              logger.error(`Failed to migrate ${key}:`, error);
            }
          }
          resolve();
        });
      });
    }

    async _migrateProviders() {
      return new Promise((resolve) => {
        chrome.storage.sync.get({ providers: {} }, async (result) => {
          const providers = result.providers;
          if (providers && typeof providers === 'object' && Object.keys(providers).length > 0) {
            try {
              await this.setSecure('providers', providers);
              logger.debug('Migrated providers to secure storage');
            } catch (error) {
              logger.error('Failed to migrate providers:', error);
            }
          }
          resolve();
        });
      });
    }

    /**
     * Rotate encryption keys for enhanced security
     */
    async rotateKeys() {
      const allKeys = await this.listSecureKeys();
      const rotationPromises = [];

      for (const key of allKeys) {
        rotationPromises.push(this._rotateKeyForData(key));
      }

      await Promise.allSettled(rotationPromises);
      
      if (security) {
        security.logSecurityEvent('key_rotation_completed', {
          rotatedKeys: allKeys.length
        });
      }
    }

    async _rotateKeyForData(key) {
      try {
        const data = await this.getSecure(key);
        if (data !== null) {
          // Re-encrypt with new key
          const newKeyId = `rotated_${Date.now()}`;
          await this.setSecure(key, data, { keyRotation: newKeyId });
        }
      } catch (error) {
        logger.error(`Failed to rotate key for ${key}:`, error);
      }
    }

    /**
     * List all secure storage keys
     */
    async listSecureKeys() {
      return new Promise((resolve) => {
        chrome.storage.local.get(null, (items) => {
          const secureKeys = Object.keys(items)
            .filter(key => key.startsWith('_secure_') && !key.endsWith('_meta'))
            .map(key => key.replace('_secure_', ''));
          resolve(secureKeys);
        });
      });
    }

    /**
     * Clear all secure storage (emergency cleanup)
     */
    async clearAllSecure() {
      return new Promise((resolve, reject) => {
        chrome.storage.local.get(null, (items) => {
          const secureKeys = Object.keys(items)
            .filter(key => key.startsWith('_secure_') || key.startsWith('_key_'));
          
          if (secureKeys.length === 0) {
            return resolve();
          }

          chrome.storage.local.remove(secureKeys, () => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              if (security) {
                security.logSecurityEvent('secure_storage_cleared', {
                  itemsCleared: secureKeys.length
                });
              }
              resolve();
            }
          });
        });
      });
    }

    /**
     * Get storage statistics
     */
    async getSecureStorageStats() {
      return new Promise((resolve) => {
        chrome.storage.local.get(null, (items) => {
          const secureItems = Object.keys(items).filter(key => 
            key.startsWith('_secure_') || key.startsWith('_key_')
          );
          
          const totalSize = JSON.stringify(items).length;
          const secureSize = secureItems.reduce((size, key) => 
            size + JSON.stringify(items[key]).length, 0
          );

          resolve({
            totalKeys: Object.keys(items).length,
            secureKeys: secureItems.length,
            totalSize,
            secureSize,
            encryptionRatio: totalSize > 0 ? (secureSize / totalSize * 100).toFixed(2) : 0
          });
        });
      });
    }
  }

  // Create singleton instance
  const secureStorage = new SecureStorage();

  /**
   * Legacy adapter functions for backward compatibility
   */
  async function getSecureApiKey() {
    // First try secure storage, then fall back to legacy
    let apiKey = await secureStorage.getSecure('apiKey');
    if (!apiKey) {
      // Try legacy storage and migrate if found
      return new Promise((resolve) => {
        chrome.storage.sync.get({ apiKey: '' }, async (result) => {
          if (result.apiKey) {
            await secureStorage.setSecure('apiKey', result.apiKey);
            chrome.storage.sync.remove(['apiKey']); // Clean up legacy
            resolve(result.apiKey);
          } else {
            resolve('');
          }
        });
      });
    }
    return apiKey || '';
  }

  async function setSecureApiKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error('Invalid API key');
    }
    await secureStorage.setSecure('apiKey', apiKey);
  }

  // Public API
  return {
    SecureStorage,
    secureStorage,
    getSecureApiKey,
    setSecureApiKey,
    
    // Migration helper
    async migrateToSecureStorage() {
      await secureStorage.migrateSensitiveData();
    },
    
    // Key rotation for scheduled security maintenance
    async rotateEncryptionKeys() {
      await secureStorage.rotateKeys();
    }
  };

}));