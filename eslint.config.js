const globals = require('globals');

module.exports = [
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'safari/**',
      '**/*.min.js',
      'src/hb.js',
      'src/mupdf-wasm.js',
      'src/mupdf.engine.js',
      'src/qa/**',
      'src/wasm/**'
    ],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
        ...globals.es2021
      }
    },
    rules: {}
  }
];
