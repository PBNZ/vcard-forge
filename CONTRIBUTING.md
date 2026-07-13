# Contributing to VCF Pro

Thanks for your interest! Start with [AGENTS.md](AGENTS.md) — it is the canonical rulebook
(layout map, hard rules, architecture). This file covers the practical workflow.

## Working locally

1. Open `src/index.html` in a browser — no build step, no server, no `npm install`.
2. Run the tests before and after your change:
   ```bash
   node tests/run-tests.js
   ```
3. For WebSerial (Send to Flipper), use Chrome or Edge on desktop.

## The rules that matter most

- **Vanilla JS only** — no frameworks, bundlers, or dependencies; `file://` must keep working.
- **Spec changes need spec citations.** Behaviour of the parser/serializer/validator is
  governed by [docs/reference/vcard-compliance.md](docs/reference/vcard-compliance.md),
  which cites versit 2.1, RFC 2425/2426, RFC 6350, and RFC 6868. If your change touches
  compliance behaviour, update that document (with the section reference) and add a test.
- **Test first.** New behaviour gets a failing test in `tests/` before the implementation.
- **CHANGELOG first.** Every user-visible change is recorded under `## [Unreleased]`
  before committing.
- **Conventional Commits**, one concern per PR.
- **GPL v3 header** on new source files, **JSDoc** on functions, 4-space indent, LF endings
  (`.editorconfig` + `.gitattributes` enforce this).
- **Decisions get ADRs** — copy `docs/adr/0000-template.md` to the next number.

## Repo layout

See the START-HERE map in [AGENTS.md](AGENTS.md) and the structure diagram in
[README.md](README.md).

## Pull requests

Use the PR template. CI must be green (syntax checks + the full test suite). Maintainer
approval is required before anything lands on `main`.

## License

All contributions must be GPL v3 compatible.
