module.exports = {
  testEnvironment: 'jsdom',
  setupFiles: ['<rootDir>/jest.setup.js'],
  testTimeout: 3000, // 3 seconds to quickly identify hanging tests
  testPathIgnorePatterns: ['/node_modules/', '/e2e/'],
  modulePathIgnorePatterns: ['<rootDir>/tools/'],
  watchPathIgnorePatterns: ['<rootDir>/tools/'],
  transform: {
    '^.+\\.js$': 'babel-jest'
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(.*\\.mjs$))'
  ],
  collectCoverage: true,
  collectCoverageFrom: [
    'src/lib/adaptiveLimitDetector.js',
    'src/core/base-provider.js',
    'src/providers/openai-unified.js',
    'src/providers/anthropic-unified.js'
  ],
  coverageThreshold: {
    global: {
      lines: 80,
      statements: 80,
    },
  },
};
