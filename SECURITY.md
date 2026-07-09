# Security Policy

This project is an MCP server that talks to the BuchhaltungsButler accounting
API using real customer credentials (`BB_API_CLIENT`, `BB_API_SECRET`,
`BB_API_KEY`). A vulnerability here could expose financial/accounting data or
allow those credentials to leak, so please report security issues privately
rather than opening a public GitHub issue.

## Reporting a Vulnerability

Please report suspected vulnerabilities via **GitHub Security Advisories**:

1. Go to <https://github.com/mrvnklm/buchhaltungsbutler-mcp/security/advisories/new>.
2. Or, from the repository's **Security** tab, click **Report a vulnerability** to open a private advisory.

If you cannot use GitHub Security Advisories, email the maintainer instead
(see the GitHub profile for a contact address). Please do not file a public
issue for anything that could disclose credentials, tokens, or a way to
exfiltrate another user's accounting data.

Include, if possible:

- A description of the issue and its potential impact.
- Steps to reproduce (a minimal repro is very helpful).
- Whether it affects the local stdio server, the Cloudflare Worker (HTTP)
  deployment, or both.

## Scope

Areas of particular interest for this project:

- Handling of `BB_API_CLIENT` / `BB_API_SECRET` / `BB_API_KEY` — via
  environment variables (stdio server) or the `x-bb-api-*` request headers
  accepted by the Cloudflare Worker (`src/index-cloudflare.ts`).
- Anything that could cause credentials or upstream API responses to be
  logged, cached, or reflected back to a different caller.
- Input validation on tool arguments (Zod schemas) that could allow
  injection into upstream API requests.

## Response

This is a small, single-maintainer open-source project without a formal SLA.
Reports are reviewed as soon as reasonably possible and a fix or mitigation
is prioritized for anything involving credential exposure. You'll get an
acknowledgement and, where relevant, credit in the release notes once a fix
ships (unless you prefer to stay anonymous).

## Supported Versions

Only the latest published release on npm / the `main` branch is supported
with security fixes. There is no long-term-support branch.
