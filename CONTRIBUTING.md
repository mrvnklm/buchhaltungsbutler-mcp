# Contributing

Thanks for your interest in improving this project. It's a small,
single-maintainer repo, so this file is intentionally short.

## Getting started

```bash
npm install
npm run build      # tsc
npm test           # vitest run
npx tsc --noEmit   # typecheck only
```

You'll need BuchhaltungsButler API credentials to exercise the server
end-to-end (see `.env.example`), but the test suite does not require live
credentials — it runs against mocked HTTP responses.

## Before opening a PR

- Keep changes focused; unrelated refactors make review slower.
- Add or update tests for any behavior change (see `src/**/*.test.ts` for
  existing patterns using vitest).
- Run `npm run build`, `npm test`, and `npx tsc --noEmit` locally — CI runs
  the same checks on Node 20 and 22.
- Never include real `BB_API_CLIENT` / `BB_API_SECRET` / `BB_API_KEY` values,
  request/response fixtures with real account data, or other credentials in
  commits, tests, issues, or PR descriptions.

## Reporting bugs vs. security issues

Regular bugs: open a GitHub issue. Anything that could leak API credentials
or another user's accounting data: please follow [SECURITY.md](SECURITY.md)
instead of filing a public issue.

## Project structure (quick orientation)

- `src/api/` — HTTP client, retry/cache/rate-limit logic, error types.
- `src/tools/` — one file per MCP tool group (receipts, invoices, etc.).
- `src/utils/` — shared helpers (config parsing, formatters, pagination,
  validators).
- `src/resources/` — MCP resources exposed for context injection.
- `src/index.ts` — stdio entrypoint (local/desktop MCP clients).

There's no formal RFC process — for anything larger than a small fix or new
tool, opening an issue first to discuss the approach is appreciated but not
required.

## Releasing (maintainer only)

Publishing to npm is automated via [`.github/workflows/publish.yml`](.github/workflows/publish.yml),
triggered by pushing a `v*.*.*` tag:

```bash
npm version patch   # or minor / major -- bumps package.json and creates a git tag
git push --follow-tags
```

CI then builds, typechecks, tests, and runs `npm publish --provenance` using
the `NPM_TOKEN` repository secret. The workflow verifies the pushed tag
matches `package.json`'s version before publishing, so a manual `npm version`
mismatch fails loudly instead of publishing the wrong thing.
