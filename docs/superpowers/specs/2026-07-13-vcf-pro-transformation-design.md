# Design: transform Flipper NFC Maker Plus into a professional vCard (VCF) tool

- Date: 2026-07-13
- Status: approved (autonomous /goal session; decisions recorded here and in `docs/adr/`)

## Goal

Turn the app from "Flipper NFC tag generator that can also edit vCards" into a
**professional-grade vCard editor/creator** whose primary output is 100% RFC-compliant `.vcf`
files for vCard **2.1, 3.0, and 4.0** — and which can still generate Flipper Zero `.nfc` files
(single `text/vcard` record or dual vCard + hosted-URL record) and send them to a Flipper over
WebSerial. Every other NFC record type (URL, Text, Phone, Email, Wi-Fi, Geo, SMS, LaunchApp,
CustomMIME, SocialMedia, FaceTime, AppleMaps, HomeKit) is removed. The UI is rebuilt to use
screen real estate properly. The repository is brought up to the RepoKit standard.

## Non-goals

- PHOTO/LOGO/SOUND/KEY binary payload editing (values pass through as text/URI; no
  image/audio preview). Tracked as future work.
- Multi-vCard files (one vCard per file for now; parser accepts a stream but the editor
  edits the first card).
- A build step, framework, or npm dependency — the app stays vanilla JS on `file://`.

## Constraints (from repo rules)

- Vanilla JS, classic `<script>` tags, `file://`-compatible, relative paths only.
- GPL v3 headers on all source files; JSDoc on functions.
- `CHANGELOG.md` updated before any commit; no push to `main` without explicit user approval.

## Architecture

Five-layer core, each a classic script exposing globals (load order matters):

```
src/js/
├── vcard-standard.js    # THE property/parameter registry + version rules (data only)
├── vcard-parser.js      # text → model   (lenient: accepts all 3 versions + sloppy input)
├── vcard-serializer.js  # model → text   (strict: emits 100% spec-compliant output)
├── vcard-validator.js   # model → diagnostics (errors/warnings per target version)
├── nfc-generator.js     # NTAG213/215/216 .nfc generation (vCard single + dual record)
├── serial.js            # Flipper WebSerial transfer (kept)
├── background.js        # particle canvas (kept)
└── app.js               # UI orchestration
```

### Data model (shared shape)

A parsed/edited card is `{ version, properties: [Property] }` where `Property` is
`{ group, name, params: [{name, values:[..]}], value }`. `value` is the raw decoded string;
structured values (N, ADR, ORG, GENDER) are split/joined by the helpers in
`vcard-standard.js` so UI fields map to components losslessly. Unknown/X- properties and
parameters are preserved verbatim (round-trip safety).

### vcard-standard.js (registry)

Data tables distilled from the primary specs (see `docs/reference/vcard-compliance.md`):
per-property version availability, 4.0 cardinality, value kind (text, structured-N,
structured-ADR, date-and-or-time, URI, language-tag…), allowed TYPE values per property per
version, which properties admit TYPE in 4.0, known parameters per version. This file contains
**no behaviour** beyond lookup helpers — parser/serializer/validator all consult it, so
version knowledge lives in exactly one place.

### Parser (lenient by design)

- Splits logical lines: unfold CRLF/LF + WSP (3.0/4.0 rule), join QP soft breaks (`=` at
  end-of-line) before decoding.
- Parses `group.NAME;PARAM=v;BARE:value`, bare 2.1 params normalized to `TYPE`.
- Decodes QUOTED-PRINTABLE (+CHARSET, UTF-8/Latin-1 via TextDecoder), backslash escapes per
  the detected version, RFC 6868 caret decoding for 4.0 params.
- Never throws on unknown properties — they are kept as-is and flagged by the validator.

### Serializer (strict by design)

Per target version, from the same model:

- **4.0**: UTF-8; escape `\\` `\,` (text), `\;` (compound components), `\n`; params
  caret-encoded (RFC 6868) and quoted when containing `:;,`; folded at 75 octets keeping
  UTF-8 sequences contiguous; VERSION emitted immediately after BEGIN; property names
  upper-case.
- **3.0**: same escaping/folding; `TYPE=` prefixed params; no QP, no CHARSET.
- **2.1**: `\;` escaping only; bare TYPE params; values with non-ASCII or newlines emitted
  as `;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE` with soft line breaks < 76 chars; plain
  lines never folded (ADR 0002 records why).
- Version conversion drops/renames properties per the registry (e.g. 3.0 `LABEL` property ↔
  4.0 `LABEL` param on ADR is *not* auto-converted — dropped with a validator warning;
  `SORT-STRING` ↔ `SORT-AS` likewise) and reports what it dropped.

### Validator

Pure function `validateVCard(model, targetVersion) → [{severity, property, message}]`.
Checks: mandatory properties (2.1: N; 3.0: N+FN; 4.0: FN), cardinality (4.0 table),
property availability for the target version, TYPE value / TYPE-allowed-property rules,
PREF range, GENDER shape, date formats per version, param legality (e.g. CHARSET only in
2.1), value sanity (email shape, URI scheme) as warnings. The UI renders these live;
export of `.vcf` is allowed with warnings but blocked on errors.

### NFC layer

`nfc-generator.js` keeps: `NfcHelper`, `NTAG_CONFIG`, `buildNdefRecord`, `wrapInTlv`,
`buildUriPayload`, `NfcNtag` with `generateVcardTag`, `generateDualRecordBusinessCard`,
size calculators, `exportData`. Removes: WiFi/AAR/CustomMIME/URL-only generators.
`serial.js` keeps connect/write/read; drops the unused loader/Bad-USB methods.

## UI design

Single page, two-pane workspace (CSS grid; stacks on <900px):

- **Left pane — editor.** Card sections: Identity (FN, N components, NICKNAME), Organization
  (ORG, TITLE, ROLE), Phones, Emails & IM, Addresses (per-component ADR fields), Web (URL),
  Dates (BDAY, ANNIVERSARY), Personal (GENDER 4.0, LANG 4.0, KIND 4.0), Notes & misc (NOTE,
  CATEGORIES, UID, REV…), Other/imported (read-only passthrough rows with delete). Multi-value
  properties get add/remove rows with TYPE chips and PREF (star) control. Fields not available
  in the selected version are hidden with a count badge ("2 fields hidden in 2.1").
- **Right pane — live output (sticky).** Toolbar: version segmented control (2.1/3.0/4.0),
  import (paste/file/URL), Clear. Live serialized source with syntax highlighting; validation
  panel (errors red, warnings amber, each pointing at its property); byte size; NFC export
  card: NTAG 213/215/216 segmented control + capacity bar + compatibility mode (dual iOS+
  Android vs single Android) + hosted URL field + "Download .nfc" / "Send to Flipper";
  "Download .vcf" primary action.
- Branding: title becomes "**VCF Pro** — vCard Studio for Flipper", keeping fork credits and
  GPL footer. Dark/light theme kept.

## Testing

Node test suite (no browser, no deps) in `tests/`:

- `vcard-core.test.js` — parser, serializer, validator, registry: round-trips per version,
  folding boundaries (75-octet, multi-byte UTF-8), escaping matrices, QP encode/decode,
  mandatory-property validation, version conversion drops, RFC 6868 params, group handling,
  real-world samples (Outlook 2.1, Apple 3.0, RFC 6350 examples).
- `nfc.test.js` — NTAG layout invariants (BCC0/BCC1, CC bytes), TLV lengths, single/dual
  record sizes, capacity errors.
- `run-tests.js` — tiny runner: loads scripts via `vm`, runs suites, non-zero exit on fail.
  CI (`deploy.yml` validate job) runs it on every push/PR.

## Risks / trade-offs

- **2.1 folding ambiguity** — resolved by never folding plain 2.1 lines (QP soft breaks
  instead); recorded in ADR 0002.
- **Version conversion loss** — properties that don't exist in the target version are
  dropped, never silently: the validator lists each drop before export.
- **No modules** — globals + load order stays; acceptable at this file count, keeps `file://`.

## RepoKit application (Core + Public tier)

`AGENTS.md` canonical (START-HERE map + the rules currently in `.cursorrules`), thin
`CLAUDE.md` importing it, `docs/adr/` with template + ADRs (0001 transformation scope,
0002 2.1 folding policy), `.gitattributes`, SECURITY.md, PR/issue templates, README/
CONTRIBUTING rewritten for the new scope, CHANGELOG under `[Unreleased]`, `.cursorrules`
removed, stray `src/js/rfc.txt` (248 KB HTML dump) removed.
