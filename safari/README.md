# Safari WebExtension

This directory is the default output location for the Safari web-extension converter.
Run `npm run build:safari` on macOS to generate Xcode projects for both macOS and iOS/iPadOS.

## Build & Install on iOS / iPadOS

1. Ensure Xcode 15+ is installed and a developer account is configured.
2. Fetch dependencies and vendor WASM assets:
   ```bash
   npm install
   ```
3. Convert the Chrome extension into Safari projects:
   ```bash
   npm run build:safari
   ```
4. Open the generated project in Xcode (found under `safari/`).
5. Select the `Qwen Translator iOS` scheme and connect an iOS or iPadOS device.
6. Enable *Developer Mode* on the device (`Settings → Privacy & Security → Developer Mode`).
7. In Xcode, build and run the app on the device. The build step copies the `wasm/` assets into the extension bundle.
8. On the device, enable the extension under `Settings → Safari → Extensions`.
9. Launch Safari and start translating pages and PDFs.

Repeat the same steps with the `Qwen Translator macOS` scheme to run on macOS.
