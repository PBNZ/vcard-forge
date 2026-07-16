# Security Policy

## Scope

vCard Forge is a fully client-side web app: no server, no accounts, no analytics by default,
and no data leaves the browser except the optional "fetch a hosted .vcf" request and the
WebSerial transfer to a locally connected Flipper Zero.

## Reporting a vulnerability

Please open a [GitHub security advisory](https://github.com/PBNZ/vcard-forge/security/advisories/new)
or a private report via GitHub. Include reproduction steps and the affected browser.
You should receive a response within a week.

## Out of scope

- Misuse of generated NFC tags.
- Vulnerabilities in the Flipper Zero firmware or in browsers themselves.
