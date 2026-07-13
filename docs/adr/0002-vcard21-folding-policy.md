# 0002 — vCard 2.1 output is never folded; QP soft breaks carry long values

- Status: accepted
- Date: 2026-07-13

## Context

vCard 2.1 (versit spec §2.1.3) folds long lines using the RFC 822 §3.1.1 technique, where
unfolding treats CRLF + LWSP as equivalent to *the LWSP character* — the whitespace
survives. vCard 3.0/4.0 (RFC 2425 §5.8.1, RFC 6350 §3.2) define the opposite: unfolding
removes the CRLF *and* the whitespace. Real-world 2.1 producers and consumers are split
between the two behaviours, so any folded plain 2.1 line risks gaining or losing a space
depending on the reader.

## Decision

The serializer never folds plain vCard 2.1 lines. Values that are long, multiline, or
non-ASCII are emitted as `ENCODING=QUOTED-PRINTABLE` (plus `CHARSET=UTF-8` when non-ASCII),
using QP soft line breaks (`=` before CRLF, physical lines < 76 chars per versit §2.1.5)
— a continuation mechanism 2.1 defines unambiguously. Inline BASE64 blocks still fold with
LWSP continuations (the versit examples show this) and end with a blank line.

The parser accepts both unfolding conventions on input: CRLF + WSP is removed (3.0/4.0
rule, matching the dominant real-world 2.1 producers), and QP soft breaks are joined
before decoding.

## Consequences

- 2.1 output is byte-safe under every known unfolding implementation.
- Plain ASCII 2.1 lines can exceed 76 characters, which versit permits (the limit applies
  to QP-encoded text); extremely old 7-bit transports might still object, which we accept.
- Strict RFC 822 unfolding (whitespace-preserving) is intentionally not applied on input;
  cards folded that way by rare writers lose one space per fold — the interoperable
  trade-off.
