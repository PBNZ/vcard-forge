# vCard compliance reference (2.1 / 3.0 / 4.0)

Normative rules implemented by the vCard core library (`src/js/vcard-*.js`), each verified
against the primary specification text. Section references are given so every rule can be
re-checked at the source.

Primary sources:

- **vCard 2.1** — *vCard: The Electronic Business Card, Version 2.1*, versit Consortium,
  1996-09-18 ("versit 2.1").
- **vCard 3.0** — [RFC 2426](https://www.rfc-editor.org/rfc/rfc2426.txt), profiled on
  [RFC 2425](https://www.rfc-editor.org/rfc/rfc2425.txt) (MIME directory).
- **vCard 4.0** — [RFC 6350](https://www.rfc-editor.org/rfc/rfc6350.txt), plus
  [RFC 6868](https://www.rfc-editor.org/rfc/rfc6868.txt) (parameter value caret encoding).

## Line delimiting and folding

| Rule | 2.1 | 3.0 | 4.0 |
|------|-----|-----|-----|
| Line delimiter | CRLF | CRLF | CRLF (RFC 6350 §3.2) |
| Fold limit | no hard limit for plain lines; QP lines < 76 chars excl. CRLF (versit 2.1 §2.1.5) | SHOULD fold > 75 chars (RFC 2426 §2.6, RFC 2425 §5.8.1) | SHOULD fold at 75 octets excl. CRLF; multi-octet UTF-8 sequences MUST stay contiguous (RFC 6350 §3.2) |
| Fold mechanism | RFC 822 folding: CRLF + LWSP, allowed only where linear white space may occur; unfolding leaves the LWSP char in place (versit 2.1 §2.1.3 via RFC 822 §3.1.1) | CRLF + single WSP anywhere; unfolding removes CRLF *and* the WSP (RFC 2425 §5.8.1) | CRLF + single WSP anywhere between two characters; unfolding removes CRLF and the WSP (RFC 6350 §3.2) |

Serializer policy: 4.0/3.0 fold at 75 octets. 2.1 output is **never folded** on plain lines;
long or multiline 2.1 values use QUOTED-PRINTABLE soft line breaks (`=` CRLF), which is
unambiguous under both unfolding conventions (see ADR 0002).

Parser policy: unfolding removes CRLF + one WSP for all versions (the 3.0/4.0 rule), and QP
soft breaks are joined before decoding; this matches how real-world 2.1 producers fold.

## Character set and encoding

| Rule | 2.1 | 3.0 | 4.0 |
|------|-----|-----|-----|
| Charset | default ASCII; `CHARSET=` param per property (versit 2.1 §2.1.6) | CHARSET param **eliminated**; charset comes from the MIME Content-Type (RFC 2426 §5) | UTF-8 only, cannot be overridden (RFC 6350 §3.1) |
| Value encoding | default 7-bit; `ENCODING=` may be `7BIT`, `8BIT`, `QUOTED-PRINTABLE`, `BASE64` (versit 2.1 §2.1.5) | QP **eliminated**; only `ENCODING=b` for inline binary (RFC 2426 §5) | ENCODING param gone; binary goes in `data:` URIs |

Serializer policy for 2.1: values containing non-ASCII characters or newlines are emitted with
`;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE`.

## Value escaping

| Character | 2.1 | 3.0 | 4.0 |
|-----------|-----|-----|-----|
| `;` in compound component / param value | `\;` (versit 2.1 §2.1.3) | `\;` (RFC 2426 §2.5) | `\;` in compound fields; MAY elsewhere (RFC 6350 §3.4) |
| `,` in text value | not escaped (no rule in versit 2.1) | `\,` MUST (RFC 2426 §5) | `\,` MUST (RFC 6350 §3.4) |
| `\` in text value | not escaped (no rule in versit 2.1) | `\\` MUST (implied by escape syntax, RFC 2426 §4 ABNF) | `\\` MUST (RFC 6350 §3.4) |
| newline in text value | QP `=0D=0A` (versit 2.1 §2.1.5) | `\n` or `\N` (RFC 2426 §5) | `\n` or `\N` (RFC 6350 §3.4) |
| anything else | — | — | escaping MUST NOT be used (RFC 6350 §3.4) |

4.0 parameter values additionally use RFC 6868 caret encoding: `^n` = newline, `^^` = `^`,
`^'` = `"`. Parameter values containing `:` `;` `,` are double-quoted; DQUOTE itself must not
appear raw in a param value (RFC 6350 §5).

## Mandatory properties

| Version | Required | Source |
|---------|----------|--------|
| 2.1 | `VERSION:2.1` (anywhere in the object), `N` | versit 2.1 §2.6.6 ("must appear within the vCard data stream"), §2.2.2 ("mandatory") |
| 3.0 | `VERSION:3.0`, `N`, `FN` | RFC 2426 §5 ("The VERSION, N and FN types MUST be specified") |
| 4.0 | `VERSION:4.0` immediately after `BEGIN:VCARD`, `FN` (one or more) | RFC 6350 §6.7.9, §6.2.1 |

## Property availability by version

| Property | 2.1 | 3.0 | 4.0 | Notes |
|----------|-----|-----|-----|-------|
| FN, N, PHOTO, BDAY, ADR, TEL, EMAIL, TZ, GEO, TITLE, ROLE, LOGO, ORG, NOTE, REV, SOUND, URL, UID, VERSION, KEY | yes | yes | yes | core set |
| LABEL, MAILER, AGENT | yes | yes | no | dropped in 4.0 (LABEL became an ADR *parameter*, RFC 6350 §6.3.1) |
| NICKNAME, CATEGORIES, PRODID, SORT-STRING, CLASS | no | yes | 4.0: NICKNAME/CATEGORIES/PRODID yes; SORT-STRING became `SORT-AS` param; CLASS dropped | added by RFC 2426 §5 |
| SOURCE, NAME, PROFILE | no | yes (RFC 2425 predefined) | SOURCE only | RFC 2426 §2.1 |
| IMPP | no | yes (RFC 4770 extension) | yes | |
| KIND, XML, ANNIVERSARY, GENDER, LANG, MEMBER, RELATED, CLIENTPIDMAP, FBURL, CALADRURI, CALURI | no | no | yes | new in RFC 6350 |
| X- extensions | yes | yes | yes | |

## vCard 4.0 cardinalities (RFC 6350 §6)

`1` exactly one; `1*` at least one; `*1` at most one; `*` any number.

- `1`: VERSION (BEGIN/END structural)
- `1*`: FN
- `*1`: KIND, N, BDAY, ANNIVERSARY, GENDER, PRODID, REV, UID
- `*`: everything else

## Structured property shapes

- **N** — 5 components: Family; Given; Additional; Prefixes; Suffixes (versit 2.1 §2.2.2,
  RFC 2426 §3.1.2, RFC 6350 §6.2.2). Components may hold comma-separated lists in 3.0/4.0.
- **ADR** — 7 components: PO box; extended; street; locality; region; postal code; country.
  Missing components keep their separators. In 4.0 the first two SHOULD be empty
  (RFC 6350 §6.3.1).
- **ORG** — organization name plus any number of unit components (RFC 2426 §3.5.5).
- **GENDER** (4.0) — sex component `M/F/O/N/U` or empty, optional `;` free-text identity
  (RFC 6350 §6.2.7).

## TYPE parameter

- 2.1: bare values without `TYPE=` are valid (`TEL;WORK;VOICE:`); known values per versit 2.1
  ABNF `knowntype` (DOM, INTL, POSTAL, PARCEL, HOME, WORK, PREF, VOICE, FAX, MSG, CELL, PAGER,
  BBS, MODEM, CAR, ISDN, VIDEO, INTERNET, X400, media/key formats…).
- 3.0: `TYPE=` prefix **required** (RFC 2426 §5); values may be a comma list. TEL adds PCS;
  EMAIL default `internet`; ADR/LABEL default `intl,postal,parcel,work` (RFC 2426 §3.2.1,
  §3.3.1, §3.3.2).
- 4.0: TYPE allowed only on FN, NICKNAME, PHOTO, ADR, TEL, EMAIL, IMPP, LANG, TZ, GEO, TITLE,
  ROLE, LOGO, ORG, RELATED, CATEGORIES, NOTE, SOUND, URL, KEY, FBURL, CALADRURI, CALURI —
  "MUST NOT be applied on other properties" (RFC 6350 §5.6). General values `work` / `home`;
  TEL-specific: `text`, `voice`, `fax`, `cell`, `video`, `pager`, `textphone`
  (RFC 6350 §6.4.1). `pref` is **not** a 4.0 TYPE value — use `PREF=1..100` (RFC 6350 §5.3).

## 4.0 date/time formats (RFC 6350 §4.3)

ISO 8601:2004 *basic* (no dashes within complete dates): `19960415`, `--0415` (month+day),
`---15` (day), `1996`, `1996-04` (year-month keeps the dash), time part `T102200`,
`T1022`, `T10`, zone `Z` or `±hhmm`. BDAY/ANNIVERSARY may instead carry `VALUE=text`.
3.0 uses ISO 8601 extended (`1996-04-15`, RFC 2426 §3.1.5); 2.1 uses ISO 8601
(`19960415` or `1996-04-15`, versit 2.1 §2.2.4).

## Property/parameter name case

Names are case-insensitive; upper-case RECOMMENDED on output (RFC 6350 §3.3). Group prefix
`group.PROP` is valid in all three versions.
