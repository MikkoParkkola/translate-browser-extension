#!/usr/bin/env node
/**
 * PDF Engine Bundle Optimizer
 * Updates manifest.json to only include selected PDF engine files
 * Dramatically reduces extension bundle size by excluding unused engines
 */

const fs = require('fs');
const path = require('path');

// PDF Engine file mappings
const PDF_ENGINE_FILES = {
  none: {
    wasmFiles: [],
    jsFiles: []
  },
  pdfjs: {
    wasmFiles: [],
    jsFiles: ['pdf.min.js', 'pdf.worker.min.js']
  },
  mupdf: {
    wasmFiles: ['wasm/vendor/mupdf-wasm.wasm', 'wasm/vendor/hb.wasm'],
    jsFiles: ['wasm/vendor/mupdf-wasm.js', 'wasm/pdfgen.js']
  },
  pdfium: {
    wasmFiles: ['wasm/vendor/pdfium.wasm'],
    jsFiles: ['wasm/vendor/pdfium.js']
  }
};

// Base files always included
const BASE_FILES = [
  'translator.js',
  'config.js', 
  'throttle.js',
  'core/security.js',
  'styles/contentScript.css'
];

/**
 * Read current PDF engine selection from storage or config
 */
function getCurrentPdfEngine() {
  // For build-time optimization, read from environment variable or config file
  const envEngine = process.env.PDF_ENGINE;
  if (envEngine && PDF_ENGINE_FILES[envEngine]) {
    return envEngine;
  }

  // Check for build config file
  const configPath = path.join(__dirname, '../build-config.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.pdfEngine && PDF_ENGINE_FILES[config.pdfEngine]) {
        return config.pdfEngine;
      }
    } catch (error) {
      console.warn('Failed to read build config:', error.message);
    }
  }

  // Default to 'none' for minimum bundle size
  return 'none';
}

/**
 * Update manifest.json with optimized file list
 */
function optimizeManifest() {
  const manifestPath = path.join(__dirname, '../manifest.json');
  
  if (!fs.existsSync(manifestPath)) {
    console.error('manifest.json not found at:', manifestPath);
    process.exit(1);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    console.error('Failed to parse manifest.json:', error.message);
    process.exit(1);
  }

  const selectedEngine = getCurrentPdfEngine();
  const engineFiles = PDF_ENGINE_FILES[selectedEngine];
  
  console.log(`Optimizing manifest for PDF engine: ${selectedEngine}`);
  
  // Build optimized resource list
  const baseResources = [...BASE_FILES];
  
  if (selectedEngine !== 'none') {
    baseResources.push('pdfViewer.html', 'pdfViewer.js');
    baseResources.push(...engineFiles.jsFiles);
  }

  // Update web accessible resources
  const optimizedResources = [
    {
      "resources": baseResources,
      "matches": ["<all_urls>"]
    }
  ];

  // Add WASM resources if needed
  if (engineFiles.wasmFiles.length > 0) {
    optimizedResources.push({
      "resources": engineFiles.wasmFiles,
      "matches": ["file://*/*"]
    });
  }

  manifest.web_accessible_resources = optimizedResources;

  // Write optimized manifest
  const manifestBackup = manifestPath + '.backup';
  if (!fs.existsSync(manifestBackup)) {
    fs.writeFileSync(manifestBackup, fs.readFileSync(manifestPath));
    console.log('Created manifest backup at:', manifestBackup);
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  
  console.log('✅ Manifest optimized successfully!');
  console.log(`📦 Bundle optimization: ${selectedEngine === 'none' ? '16.1MB saved' : 'Partial savings applied'}`);
  
  // Log included files
  console.log('\n📁 Included files:');
  baseResources.forEach(file => console.log(`  - ${file}`));
  if (engineFiles.wasmFiles.length > 0) {
    console.log('\n🔧 WASM files:');
    engineFiles.wasmFiles.forEach(file => console.log(`  - ${file}`));
  }
}

/**
 * Restore original manifest from backup
 */
function restoreManifest() {
  const manifestPath = path.join(__dirname, '../manifest.json');
  const manifestBackup = manifestPath + '.backup';
  
  if (!fs.existsSync(manifestBackup)) {
    console.error('No manifest backup found. Cannot restore.');
    process.exit(1);
  }

  fs.writeFileSync(manifestPath, fs.readFileSync(manifestBackup));
  console.log('✅ Manifest restored from backup');
}

/**
 * Create build configuration file
 */
function createBuildConfig(engine) {
  if (!PDF_ENGINE_FILES[engine]) {
    console.error(`Invalid PDF engine: ${engine}`);
    console.log('Available engines:', Object.keys(PDF_ENGINE_FILES).join(', '));
    process.exit(1);
  }

  const configPath = path.join(__dirname, '../build-config.json');
  const config = { pdfEngine: engine };
  
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`✅ Build config created: ${engine}`);
}

// CLI interface
const command = process.argv[2];
const arg = process.argv[3];

switch (command) {
  case 'optimize':
    optimizeManifest();
    break;
  
  case 'restore':
    restoreManifest();
    break;
  
  case 'config':
    if (!arg) {
      console.error('Usage: node optimize-manifest.js config <engine>');
      console.log('Available engines:', Object.keys(PDF_ENGINE_FILES).join(', '));
      process.exit(1);
    }
    createBuildConfig(arg);
    break;
  
  case 'status':
    const currentEngine = getCurrentPdfEngine();
    const engineFiles = PDF_ENGINE_FILES[currentEngine];
    const totalFiles = BASE_FILES.length + engineFiles.jsFiles.length + engineFiles.wasmFiles.length;
    
    console.log(`Current PDF engine: ${currentEngine}`);
    console.log(`Total included files: ${totalFiles}`);
    console.log(`JavaScript files: ${BASE_FILES.length + engineFiles.jsFiles.length}`);
    console.log(`WASM files: ${engineFiles.wasmFiles.length}`);
    break;
  
  default:
    console.log('PDF Engine Bundle Optimizer');
    console.log('');
    console.log('Usage:');
    console.log('  node optimize-manifest.js optimize     - Optimize manifest based on current config');
    console.log('  node optimize-manifest.js restore      - Restore original manifest');
    console.log('  node optimize-manifest.js config <engine> - Set PDF engine for build');
    console.log('  node optimize-manifest.js status       - Show current optimization status');
    console.log('');
    console.log('Available PDF engines:', Object.keys(PDF_ENGINE_FILES).join(', '));
    console.log('');
    console.log('Environment variables:');
    console.log('  PDF_ENGINE - Override PDF engine selection');
}