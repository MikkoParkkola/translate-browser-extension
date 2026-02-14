# Contributing

Thanks for your interest in contributing to TRANSLATE!

## Setup

```bash
# Prerequisites: Node.js 18+
npm install
npm run build
```

## Load in Chrome

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked" and select the `dist/` directory

## Development

```bash
npm run dev        # Watch mode
npm run build      # Production build
npm test           # Run tests
npm run lint       # ESLint
```

## Pull Requests

1. Fork the repo and create a feature branch
2. Make your changes
3. Run `npm run lint` and `npm test`
4. Submit a PR with a clear description

## Code Style

This project uses ESLint and Prettier. Run `npm run lint` before submitting.
