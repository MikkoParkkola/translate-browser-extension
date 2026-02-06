#!/bin/bash
# Build script for Firefox extension
# Creates dist-firefox/ with MV2 manifest and background page

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$PROJECT_ROOT/dist"
FIREFOX_DIST="$PROJECT_ROOT/dist-firefox"

echo "=== Building Firefox Extension ==="

# Step 1: Build Chrome version first (shared codebase)
echo "[1/5] Building shared code with Vite..."
cd "$PROJECT_ROOT"
npm run build

# Step 2: Create Firefox dist directory
echo "[2/5] Creating Firefox distribution..."
rm -rf "$FIREFOX_DIST"
cp -r "$DIST_DIR" "$FIREFOX_DIST"

# Step 3: Replace manifest with Firefox version
echo "[3/5] Replacing manifest with Firefox MV2..."
cp "$PROJECT_ROOT/src/manifest.firefox.json" "$FIREFOX_DIST/manifest.json"

# Step 4: Copy Firefox-specific background page
echo "[4/5] Setting up Firefox background page..."
cp "$PROJECT_ROOT/src/background-firefox.html" "$FIREFOX_DIST/background.html"

# Build Firefox background script using Vite with specific entry
# For now, we use the same background.js but wrapped
# The Firefox background script will be built separately

# Create a simple wrapper that loads the background script
cat > "$FIREFOX_DIST/background-firefox.js" << 'EOF'
// Firefox background wrapper
// Loads the main background functionality with browser.* polyfill support

// Firefox natively supports browser.* API
// This wrapper ensures compatibility

(async () => {
  try {
    // Import the main background module
    const module = await import('./background.js');
    console.log('[Firefox] Background module loaded');
  } catch (error) {
    console.error('[Firefox] Failed to load background module:', error);
  }
})();
EOF

# Step 5: Fix paths in manifest
echo "[5/5] Adjusting paths..."

# The Firefox manifest uses background.html which loads background-firefox.js
# We need to ensure the HTML paths work correctly

# Update background.html to reference correct JS file
cat > "$FIREFOX_DIST/background.html" << 'EOF'
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>TRANSLATE! Background</title>
</head>
<body>
  <script type="module" src="./background.js"></script>
</body>
</html>
EOF

echo ""
echo "=== Firefox Build Complete ==="
echo "Output: $FIREFOX_DIST"
echo ""
echo "To test in Firefox:"
echo "  1. Open Firefox Developer Edition"
echo "  2. Navigate to about:debugging#/runtime/this-firefox"
echo "  3. Click 'Load Temporary Add-on'"
echo "  4. Select manifest.json from $FIREFOX_DIST"
echo ""
echo "To create XPI for distribution:"
echo "  cd $FIREFOX_DIST && zip -r ../translate-firefox.xpi *"
