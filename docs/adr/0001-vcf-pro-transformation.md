# 0001 — Transform the app into a vCard-first tool (VCF Pro)

- Status: accepted
- Date: 2026-07-13

## Context

The fork started as a general Flipper Zero NFC tag generator (URL, Wi-Fi, SMS, Geo,
HomeKit, …) with a vCard editor bolted on. The vCard path was the only part with real
depth, and the general tag generator was a thin wrapper around NDEF records that other
tools already cover. Maintaining fifteen record types diluted the product and the code.

## Decision

Make the vCard editor the product. Keep exactly three capabilities:

1. A professional vCard editor/creator emitting RFC-compliant `.vcf` output for
   vCard 2.1, 3.0, and 4.0 (versit 2.1, RFC 2426, RFC 6350 — see
   `docs/reference/vcard-compliance.md`).
2. Flipper Zero `.nfc` generation for contacts (single `text/vcard` record, or the
   dual vCard + hosted-URL record for iOS + Android).
3. WebSerial transfer to the Flipper.

Remove every other record type from the UI and the NFC layer. Split the vCard logic into
registry / parser / serializer / validator so version rules live in one place.

## Consequences

- The parser stays lenient and the serializer strict, so imported cards can be cleaned up
  and re-exported to any of the three versions with explicit warnings about drops.
- Users needing URL/Wi-Fi/etc. tags must use the upstream project or another tool.
- The NDEF building blocks (`buildNdefRecord`, `wrapInTlv`, URI prefix compression) remain
  in `nfc-generator.js`, so re-adding record types later is possible but not a goal.
