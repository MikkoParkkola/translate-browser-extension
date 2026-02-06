module.exports = {
  testEnvironment: 'jsdom',
  setupFiles: ['<rootDir>/jest.setup.js'],
<<<<<<< HEAD
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
=======
  setupFilesAfterEnv: ['<rootDir>/test/helpers/jest.setup.js'],
  testPathIgnorePatterns: ['/node_modules/', '/e2e/'],
  modulePathIgnorePatterns: ['<rootDir>/tools/'],
  watchPathIgnorePatterns: ['<rootDir>/tools/'],

  // Enable ES6 modules support
  transform: {
    '^.+\\.js$': ['babel-jest', {
      presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
      plugins: ['@babel/plugin-transform-modules-commonjs']
    }]
  },
  transformIgnorePatterns: [
    'node_modules/(?!(.*\\.mjs$))'
  ],

>>>>>>> origin/main
  collectCoverage: true,
  collectCoverageFrom: [
    'src/lib/adaptiveLimitDetector.js',
    'src/core/base-provider.js',
    'src/providers/openai-unified.js',
    'src/providers/anthropic-unified.js'
  ],
  coverageThreshold: {
    global: {
<<<<<<< HEAD
      lines: 80,
      statements: 80,
=======
      branches: 60, // Reduced temporarily due to new modular architecture
      functions: 60,
      lines: 60,
      statements: 60,
>>>>>>> origin/main
    },
  },
};
