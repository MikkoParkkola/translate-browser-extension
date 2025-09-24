/**
 * LocalModelManager validation functionality tests
 * Tests model integrity validation, checksums, and GGUF format validation
 */

// Mock Web Crypto API
global.crypto = {
  subtle: {
    digest: jest.fn().mockResolvedValue(new ArrayBuffer(32)), // Mock SHA-256 hash
    importKey: jest.fn()
  }
};

global.indexedDB = {
  open: jest.fn(),
  deleteDatabase: jest.fn()
};

describe('LocalModelManager Validation Functionality', () => {
  let LocalModelManager;
  let modelManager;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    // Mock console methods
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    LocalModelManager = require('../src/localModel.js');
    modelManager = new LocalModelManager();

    // Mock crypto.subtle.digest to return deterministic hash
    global.crypto.subtle.digest.mockImplementation((algorithm, data) => {
      // Return a consistent hash for testing
      const mockHash = new Uint8Array(32).fill(0x42); // Fill with 0x42
      return Promise.resolve(mockHash.buffer);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Model Integrity Validation', () => {
    test('should validate model integrity with all checks enabled', async () => {
      // Mock model data
      const mockModelData = new ArrayBuffer(1024);
      modelManager.modelData = mockModelData;
      modelManager.currentModelVersion = '1.0.0';

      // Enable all validation checks
      modelManager.validationConfig = {
        enableChecksumValidation: true,
        enableSizeValidation: true,
        enableStructuralValidation: true,
        checksumAlgorithm: 'sha256',
        sizeTolerance: 0.001
      };

      // Mock individual validation methods to return success
      modelManager.validateChecksum = jest.fn().mockResolvedValue({
        passed: true,
        message: 'Checksum validation passed',
        details: { algorithm: 'sha256', expected: 'hash1', computed: 'hash1' }
      });

      modelManager.validateSize = jest.fn().mockResolvedValue({
        passed: true,
        message: 'Size validation passed'
      });

      modelManager.validateGGUFStructure = jest.fn().mockResolvedValue({
        passed: true,
        message: 'GGUF structure validation passed'
      });

      const result = await modelManager.validateModelIntegrity();

      expect(result.isValid).toBe(true);
      expect(result.validationResults).toHaveLength(3);
      expect(result.validationResults[0].type).toBe('checksum');
      expect(result.validationResults[1].type).toBe('size');
      expect(result.validationResults[2].type).toBe('gguf_structure');
    });

    test('should handle validation failures', async () => {
      const mockModelData = new ArrayBuffer(1024);
      modelManager.modelData = mockModelData;

      modelManager.validateChecksum = jest.fn().mockResolvedValue({
        passed: false,
        message: 'Checksum mismatch',
        details: { algorithm: 'sha256', expected: 'hash1', computed: 'hash2' }
      });

      modelManager.validateSize = jest.fn().mockResolvedValue({
        passed: true,
        message: 'Size validation passed'
      });

      const result = await modelManager.validateModelIntegrity();

      expect(result.isValid).toBe(false);
      expect(result.validationResults.some(r => !r.result.passed)).toBe(true);
    });

    test('should skip disabled validation checks', async () => {
      const mockModelData = new ArrayBuffer(1024);
      modelManager.modelData = mockModelData;

      // Disable checksum validation
      modelManager.validationConfig.enableChecksumValidation = false;

      modelManager.validateSize = jest.fn().mockResolvedValue({
        passed: true,
        message: 'Size validation passed'
      });

      const result = await modelManager.validateModelIntegrity();

      expect(result.validationResults).toHaveLength(1); // Only size validation
      expect(result.validationResults[0].type).toBe('size');
    });

    test('should handle validation errors', async () => {
      const mockModelData = new ArrayBuffer(1024);
      modelManager.modelData = mockModelData;

      modelManager.validateChecksum = jest.fn().mockRejectedValue(new Error('Crypto API error'));

      const result = await modelManager.validateModelIntegrity();

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Crypto API error');
    });
  });

  describe('Checksum Validation', () => {
    test('should validate SHA-256 checksum successfully', async () => {
      const mockData = new Uint8Array([1, 2, 3, 4]).buffer;
      const expectedHash = '4242424242424242424242424242424242424242424242424242424242424242'; // 32 bytes of 0x42

      const result = await modelManager.validateChecksum(mockData, expectedHash, 'sha256');

      expect(result.passed).toBe(true);
      expect(result.details.algorithm).toBe('sha256');
      expect(global.crypto.subtle.digest).toHaveBeenCalledWith('SHA-256', mockData);
    });

    test('should detect checksum mismatch', async () => {
      const mockData = new Uint8Array([1, 2, 3, 4]).buffer;
      const expectedHash = 'different_hash';

      const result = await modelManager.validateChecksum(mockData, expectedHash, 'sha256');

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Checksum mismatch');
      expect(result.details.expected).toBe(expectedHash);
    });

    test('should handle unsupported checksum algorithms', async () => {
      const mockData = new Uint8Array([1, 2, 3, 4]).buffer;

      const result = await modelManager.validateChecksum(mockData, 'hash', 'unsupported');

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Unsupported checksum algorithm');
    });

    test('should handle crypto API errors', async () => {
      const mockData = new Uint8Array([1, 2, 3, 4]).buffer;
      global.crypto.subtle.digest.mockRejectedValue(new Error('Crypto error'));

      const result = await modelManager.validateChecksum(mockData, 'hash', 'sha256');

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Checksum computation failed');
    });
  });

  describe('Size Validation', () => {
    test('should validate model size within tolerance', async () => {
      const mockData = new ArrayBuffer(1024 * 1024 * 100); // 100MB
      const expectedSize = 1024 * 1024 * 100; // Exactly 100MB
      modelManager.validationConfig.sizeTolerance = 0.01; // 1% tolerance

      const result = await modelManager.validateSize(mockData, expectedSize);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('Size validation passed');
    });

    test('should detect size mismatch outside tolerance', async () => {
      const mockData = new ArrayBuffer(1024 * 1024 * 90); // 90MB
      const expectedSize = 1024 * 1024 * 100; // 100MB expected
      modelManager.validationConfig.sizeTolerance = 0.05; // 5% tolerance (but difference is 10%)

      const result = await modelManager.validateSize(mockData, expectedSize);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Size validation failed');
      expect(result.details.actualSize).toBe(1024 * 1024 * 90);
      expect(result.details.expectedSize).toBe(1024 * 1024 * 100);
    });

    test('should accept size within tolerance range', async () => {
      const mockData = new ArrayBuffer(1024 * 1024 * 102); // 102MB
      const expectedSize = 1024 * 1024 * 100; // 100MB expected
      modelManager.validationConfig.sizeTolerance = 0.03; // 3% tolerance

      const result = await modelManager.validateSize(mockData, expectedSize);

      expect(result.passed).toBe(true); // 2% difference is within 3% tolerance
    });
  });

  describe('GGUF Structure Validation', () => {
    test('should validate GGUF header structure', async () => {
      // Create mock GGUF file with proper header
      const ggufMagic = new TextEncoder().encode('GGUF');
      const version = new Uint32Array([3]); // Version 3
      const tensorCount = new Uint64Array([BigInt(100)]); // 100 tensors
      const kvCount = new Uint64Array([BigInt(50)]); // 50 key-value pairs

      const headerSize = ggufMagic.length + version.byteLength + tensorCount.byteLength + kvCount.byteLength;
      const mockData = new ArrayBuffer(headerSize + 1024); // Header + some data
      const view = new Uint8Array(mockData);

      // Write GGUF header
      view.set(ggufMagic, 0);
      view.set(new Uint8Array(version.buffer), 4);
      view.set(new Uint8Array(tensorCount.buffer), 8);
      view.set(new Uint8Array(kvCount.buffer), 16);

      const result = await modelManager.validateGGUFStructure(mockData);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('GGUF structure validation passed');
      expect(result.details.version).toBe(3);
      expect(result.details.tensorCount).toBe(100);
      expect(result.details.kvCount).toBe(50);
    });

    test('should detect invalid GGUF magic number', async () => {
      // Create mock file with wrong magic number
      const wrongMagic = new TextEncoder().encode('XXXX');
      const mockData = new ArrayBuffer(32);
      const view = new Uint8Array(mockData);
      view.set(wrongMagic, 0);

      const result = await modelManager.validateGGUFStructure(mockData);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Invalid GGUF magic number');
    });

    test('should handle insufficient data for header', async () => {
      const mockData = new ArrayBuffer(2); // Too small for header

      const result = await modelManager.validateGGUFStructure(mockData);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Insufficient data for GGUF header');
    });

    test('should validate supported GGUF versions', async () => {
      const ggufMagic = new TextEncoder().encode('GGUF');
      const unsupportedVersion = new Uint32Array([999]); // Unsupported version
      const tensorCount = new Uint64Array([BigInt(100)]);
      const kvCount = new Uint64Array([BigInt(50)]);

      const headerSize = ggufMagic.length + unsupportedVersion.byteLength + tensorCount.byteLength + kvCount.byteLength;
      const mockData = new ArrayBuffer(headerSize);
      const view = new Uint8Array(mockData);

      view.set(ggufMagic, 0);
      view.set(new Uint8Array(unsupportedVersion.buffer), 4);
      view.set(new Uint8Array(tensorCount.buffer), 8);
      view.set(new Uint8Array(kvCount.buffer), 16);

      const result = await modelManager.validateGGUFStructure(mockData);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Unsupported GGUF version');
    });
  });

  describe('Compute Checksum', () => {
    test('should compute SHA-256 checksum', async () => {
      const mockData = new Uint8Array([1, 2, 3, 4]).buffer;

      const result = await modelManager.computeChecksum(mockData, 'sha256');

      expect(result).toBe('4242424242424242424242424242424242424242424242424242424242424242');
      expect(global.crypto.subtle.digest).toHaveBeenCalledWith('SHA-256', mockData);
    });

    test('should handle MD5 algorithm', async () => {
      const mockData = new Uint8Array([1, 2, 3, 4]).buffer;

      // Mock MD5 implementation
      modelManager.computeMD5Checksum = jest.fn().mockResolvedValue('md5hash');

      const result = await modelManager.computeChecksum(mockData, 'md5');

      expect(result).toBe('md5hash');
      expect(modelManager.computeMD5Checksum).toHaveBeenCalledWith(mockData, null);
    });

    test('should throw error for unsupported algorithms', async () => {
      const mockData = new Uint8Array([1, 2, 3, 4]).buffer;

      await expect(modelManager.computeChecksum(mockData, 'unsupported'))
        .rejects.toThrow('Unsupported checksum algorithm: unsupported');
    });

    test('should handle large files by throwing not implemented error', async () => {
      // Create large buffer (over 64MB chunk size)
      const largeData = new ArrayBuffer(70 * 1024 * 1024); // 70MB

      await expect(modelManager.computeChecksum(largeData, 'sha256'))
        .rejects.toThrow('Large file checksum computation not fully implemented');
    });
  });

  describe('Validation Progress Tracking', () => {
    test('should track validation progress with callback', async () => {
      const mockData = new ArrayBuffer(1024);
      modelManager.modelData = mockData;

      const progressCallback = jest.fn();

      // Mock validation methods with progress simulation
      modelManager.validateChecksum = jest.fn().mockImplementation(async () => {
        progressCallback({ step: 'checksum', progress: 33, message: 'Validating checksum...' });
        return { passed: true, message: 'Checksum validation passed' };
      });

      modelManager.validateSize = jest.fn().mockImplementation(async () => {
        progressCallback({ step: 'size', progress: 66, message: 'Validating size...' });
        return { passed: true, message: 'Size validation passed' };
      });

      modelManager.validateGGUFStructure = jest.fn().mockImplementation(async () => {
        progressCallback({ step: 'structure', progress: 100, message: 'Validating structure...' });
        return { passed: true, message: 'Structure validation passed' };
      });

      await modelManager.validateModelIntegrity(progressCallback);

      expect(progressCallback).toHaveBeenCalledTimes(3);
      expect(progressCallback).toHaveBeenCalledWith({ step: 'checksum', progress: 33, message: 'Validating checksum...' });
      expect(progressCallback).toHaveBeenCalledWith({ step: 'size', progress: 66, message: 'Validating size...' });
      expect(progressCallback).toHaveBeenCalledWith({ step: 'structure', progress: 100, message: 'Validating structure...' });
    });
  });

  describe('Model Data Access', () => {
    test('should handle missing model data', async () => {
      modelManager.modelData = null;

      const result = await modelManager.validateModelIntegrity();

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('No model data available');
    });

    test('should load model from storage for validation', async () => {
      // Mock storage access
      modelManager.loadModelFromStorage = jest.fn().mockResolvedValue(new ArrayBuffer(1024));

      modelManager.validateChecksum = jest.fn().mockResolvedValue({
        passed: true,
        message: 'Checksum validation passed'
      });

      const result = await modelManager.validateModelIntegrity();

      expect(modelManager.loadModelFromStorage).toHaveBeenCalled();
      expect(result.isValid).toBe(true);
    });
  });
});