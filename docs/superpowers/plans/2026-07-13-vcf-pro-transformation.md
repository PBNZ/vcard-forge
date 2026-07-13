# VCF Pro Transformation Implementation Plan

> **For agentic workers:** executed inline in the authoring session (autonomous /goal run,
> TDD per task, commit per task). Spec: `docs/superpowers/specs/2026-07-13-vcf-pro-transformation-design.md`.

**Goal:** Rebuild the app as a professional RFC-compliant vCard 2.1/3.0/4.0 editor with
Flipper `.nfc` export, and bring the repo to the RepoKit standard.

**Architecture:** Registry-driven vCard core (standard/parser/serializer/validator as classic
scripts sharing a `{version, properties[]}` model), trimmed NFC layer, rebuilt two-pane UI.

**Tech Stack:** Vanilla JS (no deps, `file://`-safe), Node built-in `vm` for tests, GitHub
Actions CI.

## Global Constraints

- Vanilla JS only; classic `<script>` tags; relative paths; works from `file://`.
- GPL v3 header + JSDoc in every source file.
- `CHANGELOG.md` updated in every commit with user-visible changes.
- Never push to `main` without explicit user approval.
- All compliance rules come from `docs/reference/vcard-compliance.md` (cited to primary specs).

---

### Task 1: vCard core — registry + parser + serializer + validator (TDD)

**Files:**
- Create: `src/js/vcard-standard.js` — registry: `VCARD_VERSIONS`, `VCARD_PROPERTIES`
  (per-property `{versions, cardinality40, valueKind, typeValues, typeAllowed40, structured}`),
  helpers `vcardPropertyDef(name)`, `vcardPropertyAvailable(name, version)`.
- Create: `src/js/vcard-parser.js` — `parseVCardStream(text) → [{version, properties, warnings}]`,
  `parseVCard(text) → model` (first card), unfolding, QP + charset decode, escape decode,
  RFC 6868 decode, bare-2.1-param normalization.
- Create: `src/js/vcard-serializer.js` — `serializeVCard(model, targetVersion) →
  {text, dropped:[..]}` implementing per-version folding/escaping/QP/param rules;
  `convertVCardVersion(model, target)`.
- Create: `src/js/vcard-validator.js` — `validateVCard(model, targetVersion) →
  [{severity:'error'|'warning', property, message}]`.
- Test: `tests/vcard-core.test.js`, runner `tests/run-tests.js` (also runs nfc tests).
- Delete: `src/js/rfc.txt` (misplaced 248 KB HTML dump).

**Interfaces:** model = `{version:'2.1'|'3.0'|'4.0', properties:[{group:string|null,
name:string, params:[{name:string, values:string[]}], value:string}]}`. All later tasks
consume exactly these function names.

Steps: write failing tests covering the compliance matrix → run (fail) → implement registry →
parser → serializer → validator until green → commit.

### Task 2: NFC layer trim

**Files:**
- Modify: `src/js/nfc-generator.js` — keep `NfcHelper`, `NTAG_CONFIG`, `buildNdefRecord`,
  `wrapInTlv`, `buildUriPayload`, `NfcNtag` (`generateVcardTag`,
  `generateDualRecordBusinessCard`, `calculateSingleRecordSize`, `calculateDualRecordSize`,
  `exportData`); remove URL/WiFi/AAR/CustomMIME generators.
- Modify: `src/js/serial.js` — keep connection + `writeFile`/`writeCommand`; drop loader/BadUSB.
- Test: `tests/nfc.test.js` — BCC0/BCC1, CC bytes, TLV length (short/long), dual-record size,
  capacity overflow error, .nfc header fields.

Steps: failing tests → trim → green → commit.

### Task 3: UI rebuild

**Files:**
- Rewrite: `src/index.html` — two-pane workspace per spec §UI design.
- Rewrite: `src/css/styles.css` — grid layout, sticky preview, chips, validation panel,
  keep CSS-custom-property theming.
- Rewrite: `src/js/app.js` — editor state = the model; render sections from
  `VCARD_PROPERTIES`; live serialize+validate on input; import paste/file/URL; export .vcf;
  NFC card (.nfc download + Send to Flipper via `FlipperSerial`).

Verification: `node --check` all JS; DOM smoke test via node `vm` with a minimal DOM stub is
NOT attempted — instead manual-drive checklist in the commit message + CI syntax checks.

### Task 4: RepoKit + CI + docs

**Files:**
- Create: `AGENTS.md`, thin `CLAUDE.md`, `docs/adr/0000-template.md`,
  `docs/adr/0001-vcf-pro-transformation.md`, `docs/adr/0002-vcard21-folding-policy.md`,
  `.gitattributes`, `SECURITY.md`, `.github/PULL_REQUEST_TEMPLATE.md`,
  `.github/ISSUE_TEMPLATE/bug_report.md`, `.github/ISSUE_TEMPLATE/feature_request.md`.
- Rewrite: `README.md`, `CONTRIBUTING.md`; update `CHANGELOG.md`.
- Modify: `.github/workflows/deploy.yml` — validate job runs `node tests/run-tests.js`.
- Delete: `.cursorrules` (content absorbed into `AGENTS.md`).

### Task 5: Final verification

Run full test suite + `node --check` on every JS file + HTML sanity greps; review diff;
final CHANGELOG pass; commit. Push only after explicit user approval.
