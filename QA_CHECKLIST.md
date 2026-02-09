# QA Checklist - TRANSLATE! Extension

## Pre-Deployment Checklist

### 1. Build Verification
- [ ] `npm run build` succeeds without errors
- [ ] `npm run typecheck` passes with no errors
- [ ] `npm run test` all tests pass
- [ ] No console warnings in build output

### 2. Runtime Testing

#### Service Worker
- [ ] Load extension in Chrome
- [ ] Check chrome://extensions - no errors on service worker
- [ ] Service worker console shows initialization message
- [ ] Context menus appear on right-click

#### Popup
- [ ] Popup opens without errors
- [ ] Model selector dropdown works
- [ ] Language selectors work
- [ ] Translate Page button works
- [ ] Translate Selection button works
- [ ] Undo button works
- [ ] Bilingual mode toggle works

#### Content Script
- [ ] Page translation works on example.com
- [ ] Selection translation shows tooltip
- [ ] Hover translation (Alt+hover) works
- [ ] Floating widget (Alt+W) opens
- [ ] Image translation (right-click image) works
- [ ] Undo restores original text

#### Keyboard Shortcuts
- [ ] Alt+T opens popup
- [ ] Cmd/Ctrl+Shift+T translates selection
- [ ] Cmd/Ctrl+Shift+P translates page
- [ ] Cmd/Ctrl+Shift+U undoes translation
- [ ] Alt+W toggles floating widget

#### Onboarding
- [ ] Opens on fresh install
- [ ] All 5 steps navigate correctly
- [ ] Test translation works
- [ ] Settings are saved
- [ ] Finish closes/completes correctly

### 3. Memory & Performance
- [ ] No memory leaks after extended use
- [ ] Event listeners properly cleaned up
- [ ] Caches have size limits
- [ ] No excessive console logging

### 4. Error Handling
- [ ] Network errors show user-friendly messages
- [ ] CORS errors on images handled gracefully
- [ ] Missing API keys show configuration prompts
- [ ] Timeouts handled with clear messages

## Feature-Specific Tests

### Hover Translation
- [ ] Works on paragraph text
- [ ] Works on headings
- [ ] Skips code blocks
- [ ] Skips inputs/textareas
- [ ] Cache limits at 100 entries
- [ ] Tooltip positions correctly

### Floating Widget
- [ ] Draggable
- [ ] Closes on X button
- [ ] Translation works
- [ ] History shows last 5
- [ ] Drag listeners removed on hide

### Bilingual Mode
- [ ] Shows original below translation
- [ ] Toggle works from popup
- [ ] Persists with auto-translate
- [ ] Clears on undo

### Image Translation (OCR)
- [ ] Context menu appears on images
- [ ] OCR extracts text
- [ ] Translation overlays position correctly
- [ ] CORS errors handled with message
- [ ] Overlays cleared on undo

### Learn from Corrections
- [ ] Translated text is editable
- [ ] Enter saves correction
- [ ] Escape cancels edit
- [ ] Future translations use corrections
- [ ] Corrections persist across sessions

## Code Quality Gates

### Before Merging
- [ ] All new code has tests
- [ ] No TODO comments in new code
- [ ] Function ordering verified (no forward references to non-hoisted functions)
- [ ] Event listeners have cleanup paths
- [ ] Error messages are user-friendly

### Review Checklist
- [ ] Race conditions addressed
- [ ] State cleared before async cleanup
- [ ] DOM mutations don't leak
- [ ] Message types match between sender/receiver
