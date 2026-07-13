# AGENTS.md — VCF Pro (Flipper-NFC-Maker-Plus)

Canonical instructions for AI agents and contributors. `CLAUDE.md` imports this file.

## START HERE — where things live

| What | Where |
|------|-------|
| Rules & orientation | this file |
| Decisions & rationale | `docs/adr/` (template: `docs/adr/0000-template.md`) |
| vCard compliance rules (cited to the specs) | `docs/reference/vcard-compliance.md` |
| Design spec & implementation plan | `docs/superpowers/specs/`, `docs/superpowers/plans/` |
| App source | `src/` (classic scripts, load order in `src/index.html`) |
| Tests | `tests/` — run with `node tests/run-tests.js` |
| CI & deployment | `.github/workflows/deploy.yml` |
| User-visible changes | `CHANGELOG.md` under `## [Unreleased]` |
| Contributor guide | `CONTRIBUTING.md` |

## What this project is

A professional, client-side vCard (.vcf) editor/creator producing RFC-compliant output for
vCard **2.1, 3.0, and 4.0**, with Flipper Zero `.nfc` contact-tag export (NTAG213/215/216)
and WebSerial transfer. No build step, no server, no dependencies.

## Hard rules

1. **CHANGELOG first.** Update `CHANGELOG.md` (`## [Unreleased]`) with every user-visible
   change *before* committing.
2. **Never push to `main` without explicit user approval.** Commit locally; ask before
   `git push`.
3. **Vanilla JS only.** No frameworks, bundlers, or npm dependencies. Everything must run
   from `file://` in a modern browser. Classic `<script>` tags — load order matters
   (registry → parser → serializer → validator → nfc → background → serial → app).
4. **Relative paths only** (GitHub Pages + `file://` compatibility).
5. **GPL v3 header** at the top of every new `.js`/`.css` file; **JSDoc** on functions.
6. **Compliance claims need citations.** Any parser/serializer/validator behaviour change
   must trace to `docs/reference/vcard-compliance.md` (which cites versit 2.1,
   RFC 2425/2426, RFC 6350, RFC 6868). Verify against the spec text, not memory.
7. **Tests must pass**: `node tests/run-tests.js` before every commit. New serializer/
   parser behaviour gets a test first (TDD).
8. **Conventional Commits** (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `ci:`).
9. **Record notable decisions as ADRs** in `docs/adr/` (next zero-padded number).

## Architecture in one paragraph

`vcard-standard.js` is the single registry of per-version property/parameter rules plus the
shared codecs (escaping, quoted-printable, date normalization). `vcard-parser.js` is lenient
(reads all three versions and sloppy input into a `{version, properties[]}` model);
`vcard-serializer.js` is strict (emits 100% spec-compliant text for a target version,
converting between versions and reporting drops); `vcard-validator.js` turns a model +
target version into error/warning diagnostics. `app.js` renders the editor from the
registry and keeps the model, live preview, and export buttons in sync. `nfc-generator.js`
builds Flipper `.nfc` files (single `text/vcard` record or dual vCard+URL record);
`serial.js` sends them over WebSerial.
