# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.1.x   | :white_check_mark: |
| < 2.1   | :x: |

## Reporting a Vulnerability

If you discover a security vulnerability in TRANSLATE!, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, email **mikko.parkkola@iki.fi** with:

1. A description of the vulnerability
2. Steps to reproduce
3. Impact assessment
4. Affected browser(s) and version(s)
5. Any suggested fix (optional)

You will receive an acknowledgment within 48 hours and an initial assessment within 7 days.

## Security Scope

In scope:

- Leakage of provider API keys or translated document/page content
- XSS or DOM injection through translated output, popup UI, options UI, or PDF flows
- Unsafe extension privilege escalation or access outside declared permissions
- Tampered or unsafe loading of model, WASM, or PDF-processing assets
- Compromised build or release artifacts

Out of scope:

- Translation quality issues or model hallucinations
- Provider-side outages, latency, or quota exhaustion
- Content policy disagreements unrelated to a security defect

## Security Practices

- Provider credentials stay user-controlled and are not required to transit through a hosted service run by this repo
- CI covers lint, typecheck, tests, build, coverage, CodeQL, secret scanning, and SBOM generation
- Public releases are built from version-controlled sources and validated in CI before publication
