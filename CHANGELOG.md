# Changelog

All notable changes to this project, relative to the
[original Flipper-NFC-Maker](https://github.com/jaylikesbunda/Flipper-NFC-Maker),
are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Design spec for the VCF Pro transformation
  (`docs/superpowers/specs/2026-07-13-vcf-pro-transformation-design.md`)
- vCard compliance reference distilled from the primary specifications — versit 2.1,
  RFC 2426/2425, RFC 6350, RFC 6868 (`docs/reference/vcard-compliance.md`)
- **iOS Compatible Business Card (VCF/vCard)** feature: dual-record NDEF tags
  with `text/vcard` MIME record (Android) + URL record (iOS Safari)
- Fully interactive **Dynamic vCard Builder Wizard** (supports import via paste or URL)
- Built-in vCard size optimization (compression) routines
- Read-only "passthrough" rendering for complex/unsupported vCard properties
- Automated vCard validation with inline visual error reporting
- Comprehensive vCard property support (`URL`, `BDAY`, `ANNIVERSARY`, `NICKNAME`, `ORG`, etc.)
- Node.js test suite (`logic_tests.js`) and mass multi-format vCard test generator
- Live capacity bar showing NDEF byte usage per tag type
- Tag type selector with automatic disable for undersized tags
- Dark/light mode with `prefers-color-scheme` auto-detection + manual toggle
- `.editorconfig` for consistent formatting across editors/AI tools
- `.gitignore` covering common build/OS/editor artifacts
- `CHANGELOG.md`, `CONTRIBUTING.md` documentation
- GitHub Actions CI workflow (`.github/workflows/deploy.yml`)
- GPL license headers in all source files
- JSDoc annotations throughout all JavaScript files
- TODO comments for future feature roadmap

### Changed
- **Visual refresh**: new navy + teal colour scheme replacing original orange
- Layout overhaul replacing vertical stacking with space-efficient "Options Grid"
- Consolidated the iOS dedicated form into the core Contact tagging flow
- "Fetch VCF" and "Hosted VCF" fields merged for unified source-of-truth
- Multi-select `TYPE` dropdowns allowing stacked parameter definitions (e.g. `WORK,PREF`)
- **System font stack**: removed Google Fonts `@import` for file:// compatibility
- **Restructured codebase**: split monolithic `script.js` into modular files
  (`nfc-generator.js`, `app.js`, `vcard-parser.js`)
- All files moved to `src/` directory structure
- Theme system changed from `body.light-theme` class to `[data-theme]` attribute
- Particle background updated with new colour palette
- All paths made relative (was using absolute `/logo_black.png`)
- Header/footer changed to text-based branding with fork credit

### Fixed
- **BCC0 calculation**: added missing `0x88` XOR per NFC Forum specification
- **CC bytes**: corrected for all three types:
  NTAG213 `0x12`, NTAG215 `0x3E`, NTAG216 `0x6D`
- **Mifare version**: now per-type instead of hardcoded NTAG215
- **NDEF long records**: proper 4-byte payload length for payloads > 255 bytes
  (fixes corrupt vCard data on NTAG215/216)
- **RFC 6350 Serialization Engine Integrity Fix**: Core updates made to `generateVcardStringFromEditor()`
- Fixed parameter loss (`otherParams`) when bouncing values between UI and parser memory
- Fixed `tel:` URI mapping bug causing syntax destruction in Optimizer pipeline
- Added strict multi-format datetime regex validation checking for BDAY and ANNIVERSARY properties 
- Replaced strict-case vCard header matching (`begin:vcard`) permitting non-compliant OS inputs
- **`generateFilename()` scoping bug**: `filename` variable was missing `let`
  in else branch, creating implicit global

### Removed
- Google Analytics tracking code
- Google Fonts external stylesheet import
- `app.js` (unused Vue.js prototype, never loaded)
- `CNAME` file (pointed to original author's domain)
