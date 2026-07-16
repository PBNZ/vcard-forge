# 0003 — Rename the project to vCard Forge

- Status: accepted
- Date: 2026-07-16

## Context

[ADR 0001](0001-vcf-pro-transformation.md) pivoted the app from a general Flipper NFC tag
generator into a vCard-first tool and gave it the interim working name **"VCF Pro"**. That
name has two problems: "VCF" is jargon most users won't recognize, and it is generic (weak as
a distinctive mark) — it also overlaps in spirit with the existing "vCard Studio" desktop app.
Meanwhile the GitHub repository and Pages URL still carried the pre-pivot slug
`Flipper-NFC-Maker-Plus`, which no longer describes the product.

We wanted a single, distinctive, self-explanatory brand applied everywhere — the UI, the docs,
the repository name, and the Pages URL.

## Decision

Rename the project to **vCard Forge**.

- Wordmark / UI title: `vCard Forge`.
- GitHub repository and Pages path: `vcard-forge`
  (`github.com/PBNZ/vcard-forge`, `pbnz.github.io/vcard-forge/`).
- The name leads with "vCard" so the purpose is obvious; "Forge" signals a precise,
  standards-serious making tool, matching the existing navy + teal identity.
- Flipper Zero `.nfc` export remains a named secondary feature, not part of the identity.

## Consequences

- The live site moves to `pbnz.github.io/vcard-forge/`. GitHub auto-redirects the old
  repository and Pages URLs, but that redirect is a grace period rather than a permanent
  guarantee, so the in-repo URLs were updated to the new slug.
- Prior decision records are left untouched as history: 0001 and 0002 keep their filenames, and
  the `docs/superpowers/` spec and plan (with their `vcf-pro` filenames) remain as the record of
  what was true at the time.
- Upstream attribution to `jaylikesbunda/Flipper-NFC-Maker`, all Flipper Zero / `.nfc` /
  WebSerial feature references, and the code identifiers `FlipperSerial` / `sendFlipperBtn` /
  `flipperStatus` are unchanged.
