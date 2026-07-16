# Changelog

All notable changes to this project, relative to the
[original Flipper-NFC-Maker](https://github.com/jaylikesbunda/Flipper-NFC-Maker),
are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **vCard Forge** — the app is now a professional vCard editor with Flipper export
  ([ADR 0001](docs/adr/0001-vcf-pro-transformation.md)): a two-pane workspace
  with a grouped property editor (identity, organization, phones, email/IM/web,
  addresses, dates & personal, notes & metadata, imported passthrough) and a
  sticky live pane showing highlighted serialized source, per-version
  validation diagnostics, a byte counter, and the Flipper NFC export card
- **RFC-compliant vCard core library**: `vcard-standard.js` (property/parameter
  registry with per-version rules and shared codecs), `vcard-parser.js`
  (lenient reader: QUOTED-PRINTABLE + CHARSET, RFC 6868 caret encoding, bare
  2.1 parameters, groups, nested AGENT), `vcard-serializer.js` (strict
  2.1/3.0/4.0 writer: 75-octet UTF-8-safe folding, per-version escaping, QP
  soft breaks, version conversion with PREF↔TYPE=pref and inline-binary↔data:-URI
  bridging, FN/N derivation), `vcard-validator.js` (mandatory properties, 4.0
  cardinality with ALTID grouping, TYPE vocabularies, PREF range, GENDER shape,
  date formats)
- Target-version switching (2.1 / 3.0 / 4.0) from one lossless master model,
  hiding unavailable fields and reporting anything dropped on export
- Import via paste, file picker, or URL fetch; export via `.vcf` download,
  clipboard copy, `.nfc` download, or WebSerial send to the Flipper
- Live NTAG213/215/216 capacity bar with tag-upgrade suggestions and an
  iOS + Android dual-record mode (vCard + hosted-URL NDEF records)
- Zero-dependency test runner (`tests/run-tests.js`) with a 72-test suite:
  vCard compliance matrix (`tests/vcard-core.test.js`) and NFC invariants —
  BCC checksums, CC bytes, TLV lengths, NDEF flags (`tests/nfc.test.js`)
- vCard compliance reference cited to the primary specifications — versit 2.1,
  RFC 2426/2425, RFC 6350, RFC 6868 (`docs/reference/vcard-compliance.md`)
- RepoKit-standard governance: canonical `AGENTS.md` with a START-HERE map,
  thin `CLAUDE.md`, ADR log (`docs/adr/`), `.gitattributes`, `SECURITY.md`,
  PR and issue templates
- Design spec and implementation plan under `docs/superpowers/`
- Dark/light mode with `prefers-color-scheme` auto-detection + manual toggle
- CI workflow: full test suite + JS/HTML validation + GitHub Pages deployment

### Changed
- Renamed the project to **vCard Forge**; the repository moved to
  `github.com/PBNZ/vcard-forge` and the live site to `pbnz.github.io/vcard-forge/`
  ([ADR 0003](docs/adr/0003-rename-to-vcard-forge.md))
- Layout rebuilt as a responsive two-pane grid (editor left, sticky live
  output right; stacks below 980px) to use screen real estate efficiently
- **Visual refresh**: navy + teal colour scheme, system font stack, no
  external fonts or analytics — fully `file://`-compatible
- `README.md` and `CONTRIBUTING.md` rewritten for the vCard-first scope
- CI: `actions/checkout`/`setup-node` bumped to v5, `configure-pages` to v6,
  `upload-pages-artifact`/`deploy-pages` to v5, Node 20 → 24 (clears the
  runner deprecation notices)

### Fixed
- **BCC0 calculation**: added missing `0x88` XOR per NFC Forum specification
- **CC bytes**: corrected per type — NTAG213 `0x12`, NTAG215 `0x3E`, NTAG216 `0x6D`
- **Mifare version**: now per-type instead of hardcoded NTAG215
- **NDEF long records**: proper 4-byte payload length for payloads > 255 bytes
  (fixes corrupt vCard data on NTAG215/216)

### Removed
- All non-contact record types (URL, Text, Phone, Email, Wi-Fi, Geo, SMS,
  Launch App, Custom MIME, Social Media, FaceTime, Apple Maps, HomeKit) —
  see [ADR 0001](docs/adr/0001-vcf-pro-transformation.md)
- Unused Flipper loader / Bad USB / directory-listing WebSerial methods
- `.cursorrules` (absorbed into `AGENTS.md`), stray `src/js/rfc.txt` HTML dump
- Google Analytics tracking code and Google Fonts import (from the original)
- `CNAME` file (pointed to the original author's domain)
