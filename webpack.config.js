/**
 * @fileoverview Webpack configuration for bundle analysis
 * Used primarily for analyzing bundle sizes and dependencies
 */

const path = require('path');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');

module.exports = {
  mode: 'development',
  entry: {
    background: './src/background.js',
    contentScript: './src/contentScript.js',
    popup: './src/popup.js',
    translator: './src/translator.js',
    config: './src/config.js',
    // Core modules
    'core/types': './src/core/types.ts',
    'core/config-manager': './src/core/config-manager.ts',
    'core/cache-manager': './src/core/cache-manager.js',
    'core/logger': './src/core/logger.js',
    'core/storage-adapter': './src/core/storage-adapter.js',
    'core/throttle-manager': './src/core/throttle-manager.js',
    'core/wasm-loader': './src/core/wasm-loader.js',
    'core/pdf-loader': './src/core/pdf-loader.js'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: false // Don't clean dist as it contains other files
  },
  resolve: {
    extensions: ['.ts', '.js', '.json'],
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
      '@popup': path.resolve(__dirname, 'src/popup'),
      '@types': path.resolve(__dirname, 'types'),
      '@wasm': path.resolve(__dirname, 'src/wasm'),
      '@lib': path.resolve(__dirname, 'src/lib')
    }
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: 'ts-loader',
          options: {
            configFile: path.resolve(__dirname, 'tsconfig.json'),
            transpileOnly: true // Skip type checking for faster builds
          }
        },
        exclude: /node_modules/
      },
      {
        test: /\.js$/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env'],
            plugins: [
              '@babel/plugin-syntax-dynamic-import'
            ]
          }
        },
        exclude: /node_modules/
      }
    ]
  },
  optimization: {
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          chunks: 'all'
        },
        common: {
          name: 'common',
          minChunks: 2,
          priority: -10,
          reuseExistingChunk: true
        },
        core: {
          test: /[\\/]src[\\/]core[\\/]/,
          name: 'core',
          chunks: 'all',
          priority: 10
        }
      }
    },
    usedExports: true,
    sideEffects: false
  },
  plugins: [
    new BundleAnalyzerPlugin({
      analyzerMode: process.env.ANALYZE === 'true' ? 'server' : 'disabled',
      analyzerPort: 8888,
      reportFilename: 'bundle-report.html',
      openAnalyzer: process.env.ANALYZE === 'true',
      generateStatsFile: true,
      statsFilename: 'bundle-stats.json',
      logLevel: 'info'
    })
  ],
  target: 'web',
  devtool: false, // No source maps for analysis
  stats: {
    all: false,
    modules: true,
    maxModules: 0,
    errors: true,
    warnings: true,
    moduleTrace: true,
    errorDetails: true
  },
  // Extension-specific settings
  externals: {
    // Chrome APIs are provided by the browser
    chrome: 'chrome'
  },
  performance: {
    hints: 'warning',
    maxAssetSize: 250000, // 250KB
    maxEntrypointSize: 250000,
    assetFilter: function(assetFilename) {
      // Don't warn about WASM files - they're lazy loaded
      return !(/\.wasm$/.test(assetFilename));
    }
  }
};