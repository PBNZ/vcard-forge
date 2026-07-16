# vCard Forge — the professional vCard editor

> A professional, fully client-side **vCard (.vcf) editor and creator** with RFC-compliant
> output for vCard **2.1, 3.0, and 4.0** — plus Flipper Zero **`.nfc` contact tag** export
> and direct WebSerial transfer.
>
> A fork of [jaylikesbunda/Flipper-NFC-Maker](https://github.com/jaylikesbunda/Flipper-NFC-Maker),
> transformed from a general NFC tag generator into a vCard-first tool
> ([ADR 0001](docs/adr/0001-vcf-pro-transformation.md)).

🌐 **Try it live:** [https://pbnz.github.io/vcard-forge/](https://pbnz.github.io/vcard-forge/)

**License:** [GNU General Public License v3](LICENSE)

---

## ✨ What it does

| Capability | Details |
|------------|---------|
| **vCard editor** | Grouped property editor (identity, organization, phones, email/IM/web, addresses, dates & personal, notes & metadata) with multi-value rows, TYPE chips, and preferred-★ handling |
| **Three standards, one model** | Switch the target between 2.1 / 3.0 / 4.0 at any time — fields that don't exist in the target are hidden, conversions (PREF ↔ TYPE=pref, inline binary ↔ `data:` URI, FN/N derivation) happen automatically, and anything that would be dropped is reported before export |
| **RFC-compliant output** | Correct folding (75-octet, UTF-8-safe), escaping, QUOTED-PRINTABLE + CHARSET for 2.1, RFC 6868 caret encoding for 4.0 parameters — every rule cited to the spec in [docs/reference/vcard-compliance.md](docs/reference/vcard-compliance.md) |
| **Live validation** | Per-version diagnostics as you type: mandatory properties, 4.0 cardinality (ALTID-aware), TYPE vocabularies, PREF range, GENDER shape, date formats |
| **Lenient import** | Paste, open a file, or fetch a URL — reads sloppy line endings, bare 2.1 parameters, QP/charsets, groups, nested AGENT cards; unknown properties round-trip untouched |
| **Flipper `.nfc` export** | NTAG213/215/216 with live capacity bar; single `text/vcard` record (Android) or dual-record vCard + hosted-URL (iOS + Android) |
| **Send to Flipper** | Direct WebSerial transfer to `/ext/nfc/` (Chrome/Edge desktop) |
| **Zero infrastructure** | No build step, no server, no dependencies, no analytics — works from `file://` |

## 🚀 Quick start

1. **Clone** (or download the ZIP):
   ```bash
   git clone https://github.com/PBNZ/vcard-forge.git
   ```
2. **Open** `src/index.html` in any modern browser
3. Build your contact, watch the live source and validation, and export `.vcf` or `.nfc`

## 🗂️ Project structure

```
├── src/
│   ├── index.html              # Two-pane workspace (editor + live output)
│   ├── css/styles.css          # Styles (dark/light theme via CSS variables)
│   └── js/
│       ├── vcard-standard.js   # Property/parameter registry + shared codecs
│       ├── vcard-parser.js     # Lenient reader (2.1/3.0/4.0 → model)
│       ├── vcard-serializer.js # Strict writer (model → compliant text)
│       ├── vcard-validator.js  # Per-version diagnostics
│       ├── nfc-generator.js    # Flipper .nfc generation (NTAG213/215/216)
│       ├── serial.js           # WebSerial transfer to the Flipper
│       ├── background.js       # Particle canvas
│       └── app.js              # UI orchestration
├── tests/                      # node tests/run-tests.js (no dependencies)
├── docs/
│   ├── adr/                    # Architecture decision records
│   └── reference/vcard-compliance.md  # The compliance rulebook, cited to the specs
├── AGENTS.md                   # Canonical agent/contributor rules (CLAUDE.md imports it)
└── .github/workflows/deploy.yml  # CI: tests + validation + GitHub Pages deploy
```

## 🧪 Testing

```bash
node tests/run-tests.js
```

72 tests cover the compliance matrix (folding, escaping, QP, version conversion,
cardinality, round trips) and the NFC layer invariants (BCC checksums, CC bytes,
TLV lengths, NDEF flags). CI runs them on every push and pull request.

## 📚 Standards implemented

- **vCard 2.1** — versit Consortium specification (1996)
- **vCard 3.0** — [RFC 2426](https://www.rfc-editor.org/rfc/rfc2426) / [RFC 2425](https://www.rfc-editor.org/rfc/rfc2425)
- **vCard 4.0** — [RFC 6350](https://www.rfc-editor.org/rfc/rfc6350) + [RFC 6868](https://www.rfc-editor.org/rfc/rfc6868)
- **NFC** — NFC Forum NDEF / Type 2 Tag layout for NTAG213/215/216, Flipper NFC file format v4

The distilled, citation-backed rulebook lives in
[docs/reference/vcard-compliance.md](docs/reference/vcard-compliance.md).

## 🗺️ Roadmap

- [ ] PHOTO/LOGO preview and file-to-`data:`-URI conversion in the editor
- [ ] Multi-card .vcf files (the parser already reads streams)
- [ ] Editable parameters on imported passthrough properties

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md). Notable decisions are
recorded in [docs/adr/](docs/adr/).

## 📜 Licensing

Licensed under the **GNU General Public License v3**.

```
Original work Copyright (c) jaylikesbunda
Modifications Copyright (c) PBNZ 2026
```

## ⚠️ Disclaimer

This tool is for educational and personal use. Ensure you have the right to create and use
NFC tags before deploying them.
