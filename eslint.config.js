const globals = require('globals');
const typescriptPlugin = require('@typescript-eslint/eslint-plugin');
const typescriptParser = require('@typescript-eslint/parser');

module.exports = [
  {
    ignores: [
      'dist/',
      'coverage/',
      'safari/',
      '**/*.min.js',
      'src/hb.js',
      'src/mupdf-wasm.js',
      'src/mupdf.engine.js',
      'src/qa/',
      'src/wasm/',
      'webpack.config.js',
      'scripts/',
      'e2e/',
      '**/*.d.ts' // Skip type definition files
    ],
  },
  // JavaScript configuration
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
        chrome: 'readonly',
        qwenCore: 'readonly',
        qwenConfig: 'readonly',
        qwenCache: 'readonly',
        qwenLogger: 'readonly',
        qwenProviders: 'readonly',
        qwenRetry: 'readonly',
        qwenTransport: 'readonly',
        isOfflineError: 'readonly',
        pdfjsLib: 'readonly',
        importScripts: 'readonly',
      },
    },
    rules: {
      // === Code Quality & Bug Prevention ===
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_'
      }],
      'no-console': 'off', // Extension uses console logging extensively
      'no-debugger': 'warn',
      'no-alert': 'warn',
      'no-duplicate-imports': 'error',
      'no-unreachable': 'error',
      'no-unreachable-loop': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-func-assign': 'error',
      'no-import-assign': 'error',
      'no-obj-calls': 'error',
      'no-unexpected-multiline': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',

      // === Chrome Extension Specific ===
      'no-implied-eval': 'error', // Security: avoid eval-like functions
      'no-new-func': 'warn', // Security: avoid Function constructor
      'no-script-url': 'error', // Security: avoid javascript: URLs

      // === Code Consistency ===
      'prefer-const': ['warn', { destructuring: 'all' }],
      'no-var': 'warn', // Prefer let/const over var
      'eqeqeq': ['warn', 'smart'], // Use === except for null checks
      'curly': ['warn', 'multi-line'], // Braces for multi-line blocks
      'brace-style': ['warn', '1tbs', { allowSingleLine: true }],
      'comma-dangle': ['warn', 'always-multiline'],
      'comma-spacing': ['warn', { before: false, after: true }],
      'comma-style': ['warn', 'last'],
      'key-spacing': ['warn', { beforeColon: false, afterColon: true }],
      'keyword-spacing': ['warn', { before: true, after: true }],
      'space-before-blocks': ['warn', 'always'],
      'space-infix-ops': 'warn',
      'space-unary-ops': ['warn', { words: true, nonwords: false }],
      'object-curly-spacing': ['warn', 'always'],
      'array-bracket-spacing': ['warn', 'never'],
      'computed-property-spacing': ['warn', 'never'],
      'func-call-spacing': ['warn', 'never'],
      'semi': ['warn', 'always'],
      'semi-spacing': ['warn', { before: false, after: true }],
      'quotes': ['warn', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
      'indent': ['warn', 2, { SwitchCase: 1, VariableDeclarator: 'first' }],

      // === Error Handling & Async Patterns ===
      'no-async-promise-executor': 'error',
      'no-await-in-loop': 'warn',
      'no-promise-executor-return': 'error',
      'require-atomic-updates': 'warn',
      'prefer-promise-reject-errors': 'warn',
      'no-return-await': 'warn',

      // === Performance & Best Practices ===
      'no-loop-func': 'warn',
      'no-new-object': 'warn',
      'no-new-wrappers': 'error',
      'no-array-constructor': 'warn',
      'prefer-object-spread': 'warn',
      'prefer-spread': 'warn',
      'prefer-template': 'warn',
      'prefer-regex-literals': 'warn',
      'no-useless-concat': 'warn',
      'no-useless-escape': 'warn',
      'no-useless-return': 'warn',
      'no-useless-computed-key': 'warn',
      'no-useless-rename': 'warn',
      'no-lone-blocks': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }], // Allow empty catch blocks (common pattern)
      
      // === Function & Variable Naming ===
      'camelcase': ['warn', { 
        properties: 'never', 
        ignoreDestructuring: true,
        allow: ['^[A-Z_]+$', '^chrome_', '^qwen_', '^_.*'] // Allow constants, chrome APIs, qwen prefix, private vars
      }],
      'new-cap': ['warn', { capIsNew: false }], // Allow factory functions
      'no-underscore-dangle': 'off', // Allow _ prefix for private members

      // === Security Rules ===
      'no-eval': 'error',
      'no-proto': 'error',
      'no-iterator': 'error',
      'no-with': 'error',

      // === Chrome Extension API Usage ===
      'no-global-assign': 'error',
      'no-implicit-globals': 'off', // Extension scripts often use globals
      'no-undef': 'error', // Catch undefined variables

      // === Module & Import Rules ===

      // === Error Prevention ===
      'no-cond-assign': ['error', 'except-parens'],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-control-regex': 'error',
      'no-dupe-else-if': 'error',
      'no-empty-character-class': 'error',
      'no-ex-assign': 'error',
      'no-extra-boolean-cast': 'warn',
      'no-invalid-regexp': 'error',
      'no-irregular-whitespace': 'error',
      'no-misleading-character-class': 'error',
      'no-regex-spaces': 'warn',
      'no-sparse-arrays': 'warn',
      'no-template-curly-in-string': 'warn',

      // === Code Style Relaxed for Extension Context ===
      'no-mixed-spaces-and-tabs': 'warn',
      'no-multiple-empty-lines': ['warn', { max: 2, maxBOF: 0, maxEOF: 1 }],
      'no-trailing-spaces': 'warn',
      'eol-last': 'warn',

      // === Specific to Large Codebase ===
      'max-len': ['warn', { 
        code: 120, 
        ignoreUrls: true, 
        ignoreStrings: true, 
        ignoreTemplateLiterals: true,
        ignoreRegExpLiterals: true,
        ignoreComments: true
      }],
      'complexity': ['warn', 15], // Allow moderate complexity for extension logic
      'max-depth': ['warn', 4],
      'max-nested-callbacks': ['warn', 4],
      'max-params': ['warn', 6], // Chrome APIs often have many parameters

      // === Testing Environment Specific ===
      // Note: Jest-specific rules would require @eslint/plugin-jest
      
      // === Allow Extension Patterns ===
      'no-unused-expressions': ['warn', { 
        allowShortCircuit: true, 
        allowTernary: true,
        allowTaggedTemplates: true 
      }],
      'no-sequences': 'warn',
      'no-void': ['warn', { allowAsStatement: true }], // Common in extension cleanup
      'prefer-arrow-callback': ['warn', { allowNamedFunctions: true }],

      // === Relaxed for UMD/CommonJS Patterns ===
      'strict': 'off', // Mixed module environments
      'no-param-reassign': 'off', // Common in translation processing
      'consistent-return': 'off', // Mixed return patterns in callbacks
    },
  },
  // TypeScript configuration
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      parser: typescriptParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
        chrome: 'readonly',
        qwenCore: 'readonly',
        qwenConfig: 'readonly',
        qwenCache: 'readonly',
        qwenLogger: 'readonly',
        qwenProviders: 'readonly',
        qwenRetry: 'readonly',
        qwenTransport: 'readonly',
        isOfflineError: 'readonly',
        pdfjsLib: 'readonly',
        importScripts: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': typescriptPlugin,
    },
    rules: {
      // Extend base JavaScript rules
      ...typescriptPlugin.configs.recommended.rules,
      ...typescriptPlugin.configs['recommended-requiring-type-checking'].rules,

      // === TypeScript-specific rules ===
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_'
      }],
      '@typescript-eslint/no-explicit-any': 'warn', // Allow any but warn
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-inferrable-types': 'warn',
      
      // === Disable JavaScript rules that conflict with TypeScript ===
      'no-unused-vars': 'off', // Use @typescript-eslint/no-unused-vars instead
      'no-undef': 'off', // TypeScript handles this
      'no-redeclare': 'off', // TypeScript handles this
      
      // === Extension-specific TypeScript rules ===
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/explicit-function-return-type': ['warn', {
        allowExpressions: true,
        allowTypedFunctionExpressions: true,
        allowHigherOrderFunctions: true,
      }],
      
      // === Relaxed for extension compatibility ===
      '@typescript-eslint/no-misused-promises': 'off', // Chrome API patterns
      '@typescript-eslint/require-await': 'off', // Common in extension async patterns
      '@typescript-eslint/no-floating-promises': 'warn', // Warn but don't error
      '@typescript-eslint/unbound-method': 'off', // Chrome API binding patterns
    },
  },
];
