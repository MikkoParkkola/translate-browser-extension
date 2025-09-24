# Simple Version Translation Fixes

## Problem Identified
The user reported that the legacy version worked "fantastic" for auto-translate and translate page functionality, but the simple version wasn't performing as well. After investigation, I found fundamental architectural differences that were causing the poor performance.

## Root Cause Analysis

### 1. **Incorrect Batching Strategy**
- **Legacy**: Used proper `translateBatch` with separate API calls for each batch of 20 nodes
- **Simple**: Joined all texts with newlines and sent as single `translate` request
- **Issue**: Single large translation requests are error-prone and don't benefit from proper caching/throttling

### 2. **Missing Background Script Handler**
- **Legacy**: Had dedicated `translateBatch` handler in background script
- **Simple**: Only had `translate` handler, forcing content script to hack with joined text
- **Issue**: No proper batch processing architecture

### 3. **Fragile Response Processing**
- **Simple**: Relied on `.split('\n')` to reconstruct individual translations
- **Issue**: Breaks if API response formatting is inconsistent

## Fixes Implemented

### 1. **Added `translateBatch` Handler to Background Script**
```javascript
case 'translateBatch':
  await this.handleBatchTranslation(request, sendResponse);
  break;
```

### 2. **Implemented Proper Batch Translation Method**
- Processes each text individually (like legacy)
- Proper caching for each text segment
- Individual throttling control
- Error handling for partial failures
- Returns array of translations matching input order

### 3. **Updated Content Script to Use Proper Batching**
```javascript
// Changed from:
type: 'translate',
text: uniqueTexts.join('\n'),

// To:
type: 'translateBatch',
texts: uniqueTexts,
```

### 4. **Fixed Response Processing**
```javascript
// Changed from fragile split:
const translatedLines = response.text.split('\n');

// To robust array access:
response.texts.forEach((text, index) => { ... });
```

## Key Architectural Improvements

1. **Robust Error Handling**: Individual text failures don't break entire batch
2. **Proper Caching**: Each text segment cached independently for reuse
3. **Better Throttling**: Token counting and rate limiting per individual text
4. **Legacy Compatibility**: Same deduplication and mapping logic as legacy version
5. **Performance**: Maintains all legacy optimizations while fixing architecture flaws

## Result
The simple version now has the same robust batch translation architecture as the legacy version that worked "fantastic". Auto-translate and translate page functionality should now perform at the same level as the legacy version.

## Files Modified
- `src/background-simple.js`: Added `handleBatchTranslation` method and routing
- `src/contentScript-simple.js`: Updated `translateOptimizedBatch` to use proper batching

## Testing
- Syntax validation passed for both modified files
- Architecture now matches proven legacy patterns
- Maintains all existing optimizations (deduplication, caching, throttling)