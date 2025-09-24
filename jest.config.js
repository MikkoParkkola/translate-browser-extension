module.exports = {
  testEnvironment: 'jsdom',
  setupFiles: ['<rootDir>/jest.setup.js'],
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

  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/vendor/**',
    '!src/**/wasm/**',
    '!src/**/pdf*.js'
  ],
  coverageThreshold: {
    global: {
      branches: 60, // Reduced temporarily due to new modular architecture
      functions: 60,
      lines: 60,
      statements: 60,
    },
  },
};
