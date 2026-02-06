/**
 * Jest setup file for modular architecture testing
 * This file is run after the test environment is set up but before tests run
 */

import { setupChromeAPIMocks } from './moduleTestHelper.js';

// Global setup that runs before all tests
beforeEach(() => {
  // Basic Chrome API mocking for all tests
  setupChromeAPIMocks();

  // Mock console methods to reduce noise in tests
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  // Clean up mocks after each test
  jest.restoreAllMocks();
});