#!/bin/bash

# TypeScript type checking script for CI/CD and pre-commit hooks
# Checks all TypeScript files and provides detailed error reporting

set -e

echo "🔍 Running TypeScript type checking..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Type check counters
ERRORS=0
WARNINGS=0

echo "📋 Checking TypeScript configuration..."
if ! npx tsc --showConfig > /dev/null 2>&1; then
    echo -e "${RED}❌ Invalid TypeScript configuration${NC}"
    exit 1
fi

echo "🔍 Type checking core modules..."
if ! npm run typecheck:core; then
    ERRORS=$((ERRORS + 1))
    echo -e "${RED}❌ Core modules type check failed${NC}"
fi

echo "🔍 Type checking popup modules..."
if ! npm run typecheck:popup; then
    ERRORS=$((ERRORS + 1))
    echo -e "${RED}❌ Popup modules type check failed${NC}"
fi

echo "🔍 Type checking all other modules..."
if ! npm run typecheck; then
    ERRORS=$((ERRORS + 1))
    echo -e "${RED}❌ General type check failed${NC}"
fi

# Check for TypeScript files that might not be included
echo "🔍 Checking for orphaned TypeScript files..."
ORPHANED=$(find src -name "*.ts" -not -path "*/node_modules/*" -not -path "*/dist/*" | wc -l)
if [ "$ORPHANED" -gt 2 ]; then # We have 2 TS files currently
    echo -e "${YELLOW}⚠️  Found $ORPHANED TypeScript files, ensure all are included in tsconfig${NC}"
    find src -name "*.ts" -not -path "*/node_modules/*" -not -path "*/dist/*"
    WARNINGS=$((WARNINGS + 1))
fi

# Check for missing type declarations
echo "🔍 Checking for missing type declarations..."
UNTYPED_JS=$(find src -name "*.js" -exec grep -l "@ts-check" {} \; | wc -l)
TOTAL_JS=$(find src -name "*.js" | wc -l)
TYPED_PERCENTAGE=$(echo "scale=2; $UNTYPED_JS * 100 / $TOTAL_JS" | bc -l 2>/dev/null || echo "0")

if (( $(echo "$TYPED_PERCENTAGE < 50" | bc -l) )); then
    echo -e "${YELLOW}⚠️  Only ${TYPED_PERCENTAGE}% of JS files have type annotations${NC}"
    WARNINGS=$((WARNINGS + 1))
fi

# Summary
echo ""
echo "📊 Type Checking Summary:"
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✅ No type errors found${NC}"
else
    echo -e "${RED}❌ Found $ERRORS type checking errors${NC}"
fi

if [ $WARNINGS -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Found $WARNINGS warnings${NC}"
fi

# Additional checks
echo ""
echo "🔍 Additional TypeScript Checks:"

# Check for any/unknown usage
ANY_USAGE=$(grep -r ": any" src --include="*.ts" | wc -l)
if [ "$ANY_USAGE" -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Found $ANY_USAGE uses of 'any' type - consider using more specific types${NC}"
fi

# Check for missing return types on functions
MISSING_RETURNS=$(grep -r "function.*(" src --include="*.ts" | grep -v ": .*{" | wc -l)
if [ "$MISSING_RETURNS" -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Found $MISSING_RETURNS functions without explicit return types${NC}"
fi

if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}🎉 All type checks passed!${NC}"
    exit 0
else
    echo -e "${RED}💥 Type checking failed with $ERRORS errors${NC}"
    exit 1
fi