# BuchhaltungsButler MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green)](https://nodejs.org/)

An MCP (Model Context Protocol) server that connects AI assistants like Claude to the [BuchhaltungsButler](https://www.buchhaltungsbutler.de/) German accounting API. Manage receipts, transactions, invoices, postings, and more through natural language.

> **Disclaimer:** This is an unofficial, community-built project and is not affiliated with, endorsed by, or supported by BuchhaltungsButler. It is provided "AS IS", without warranty of any kind (see [License](#license)). This tool can create, modify, and delete real accounting data (receipts, transactions, postings, invoices) in your BuchhaltungsButler account via natural-language instructions to an AI assistant — always review what an AI assistant is about to do before confirming, and verify postings/bookings yourself before relying on them for tax filings or other compliance purposes. This project is not a substitute for professional tax or accounting advice.

## Features

- **25 tools** covering the full BuchhaltungsButler API surface
- **5 MCP resources** for context injection (accounts, posting accounts, cost locations, creditors, debtors)
- **Batch operations** for receipts, transactions, postings, debtors, and creditors (up to 50 items)
- **Retry with backoff** on transient errors (rate limit, timeout, network failure) with configurable attempts
- **Caching layer** for static endpoints (accounts, posting accounts, cost locations) with TTL and write-triggered invalidation
- **Auto-pagination** fetches all pages automatically via `auto_paginate` parameter on `list_transactions`, `list_receipts`, and `list_postings`
- **Response truncation** with configurable `max_results` to prevent token overflow on large result sets
- **File upload from URL** in `upload_receipt` — accepts an http(s) URL (fetched server-side with content-type and size validation) or a `file://` URL for local files, restricted to directories explicitly allowed via `BB_ALLOWED_FILE_DIRS` (opt-in, disabled by default)
- **Rate limiting** — token-bucket throttling per BB API endpoint category (general, batch, upload); see [`src/api/rate-limiter.ts`](src/api/rate-limiter.ts) for exact burst/refill values
- **E-invoicing** support (XRechnung/ZUGFeRD) with structured tax data
- **Zod validation** on all tool inputs with descriptive error messages
- **LLM-friendly output** formatting for structured, readable responses

## Quick Start

### Prerequisites

You need BuchhaltungsButler API credentials:
- `BB_API_CLIENT` - API client ID
- `BB_API_SECRET` - API client secret
- `BB_API_KEY` - API key for your account

These are available in your BuchhaltungsButler account under Settings > API.

### Claude Desktop Configuration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "buchhaltungsbutler": {
      "command": "npx",
      "args": ["-y", "buchhaltungsbutler-mcp"],
      "env": {
        "BB_API_CLIENT": "your-api-client",
        "BB_API_SECRET": "your-api-secret",
        "BB_API_KEY": "your-api-key"
      }
    }
  }
}
```

That's it — no clone or manual build. `npx` downloads and caches the [npm package](https://www.npmjs.com/package/buchhaltungsbutler-mcp) automatically the first time it runs, and picks up new versions on restart.

### Running from source instead

If you want to modify the code, see [Contributing](#contributing) below.

## Tool Reference

### Accounts

| Tool | Description |
|------|-------------|
| `list_accounts` | List all payment/bank accounts (Zahlungskonten) |
| `create_account` | Create a new payment/bank account |

### Transactions

| Tool | Description |
|------|-------------|
| `list_transactions` | List bank transactions with filters (date, account, sender/recipient) |
| `get_transaction` | Get a single transaction by ID |
| `create_transaction` | Create one or batch (up to 50) transactions |
| `assign_receipt_to_transaction` | Assign, unassign, or batch-assign receipts to transactions |
| `get_assigned_documents` | Get receipts assigned to a transaction, or transactions assigned to a receipt |

### Receipts

| Tool | Description |
|------|-------------|
| `list_receipts` | List receipts (Belege) with filters (direction, dates, status, counterparty) |
| `get_receipt` | Get a single receipt by ID, optionally including file content |
| `create_receipt` | Create one or batch (up to 50) receipts |
| `upload_receipt` | Upload a receipt file (base64, http(s) URL, or file:// URL) with optional metadata |
| `manage_receipt` | Delete or restore a receipt |

### Postings

| Tool | Description |
|------|-------------|
| `list_postings` | List postings (Buchungen) within a date range |
| `create_posting` | Create receipt, transaction, or free postings (single or batch) |
| `unconfirm_posting` | Reopen a posting to allow modifications |
| `assign_receipt_to_posting` | Assign a receipt to an existing free posting |

### Invoices

| Tool | Description |
|------|-------------|
| `create_invoice` | Create and finalize an invoice, credit note, or offer |
| `create_e_invoice` | Create an e-invoice (XRechnung/ZUGFeRD) with structured tax data |
| `create_invoice_draft` | Create an invoice draft for later editing |

### Settings

| Tool | Description |
|------|-------------|
| `manage_debtors` | List, add, batch-add, or update debtor accounts (Debitoren) |
| `manage_creditors` | List, add, batch-add, or update creditor accounts (Kreditoren) |
| `manage_posting_accounts` | List, add, or update posting accounts (Buchungskonten) |

### Other

| Tool | Description |
|------|-------------|
| `list_cost_locations` | List cost locations (Kostenstellen) |
| `manage_cost_location` | Add, update, or delete a cost location |
| `add_comment` | Add a comment to a transaction or receipt |

## Architecture

The server maps 48 BuchhaltungsButler API endpoints down to 25 MCP tools by consolidating related operations:

```
src/
  index.ts                 # Node.js stdio entry point
  server.ts                # MCP server factory
  api/
    client.ts              # HTTP client with retry, caching, rate limiting
    cache.ts               # In-memory TTL cache with write invalidation
    rate-limiter.ts        # Token bucket rate limiter
    errors.ts              # API error types with transient detection
  resources/
    index.ts               # MCP resource registrations (5 resources)
  tools/
    accounts.ts            # 2 tools
    transactions.ts        # 5 tools
    receipts.ts            # 5 tools
    postings.ts            # 4 tools
    invoices.ts            # 3 tools
    settings.ts            # 3 tools
    cost-locations.ts      # 2 tools
    comments.ts            # 1 tool
  types/
    common.ts              # Shared types (BbConfig, RetryConfig, ApiResponse, etc.)
    api-responses.ts       # API response type definitions
    api-params.ts          # API parameter type definitions
  utils/
    config.ts              # Environment config loader
    formatters.ts          # LLM-friendly output formatting with truncation
    pagination.ts          # Auto-pagination helper for list endpoints
    validators.ts          # Shared Zod schemas (dates, currencies, etc.)
```

### Design Decisions

- **POST-only API**: BuchhaltungsButler uses POST for all endpoints with JSON bodies and Basic Auth. JSON (rather than `x-www-form-urlencoded`) is the format documented by the BHB API and is required to express `null` array elements, e.g. in `oi_receipts_ids_by_customer`
- **Consolidated tools**: Related CRUD operations (e.g., list/add/update/delete) are combined into single tools with an `action` parameter to reduce tool count
- **Batch support**: Tools that support batch operations accept either single-item fields or an array, automatically routing to the correct API endpoint
- **Rate limiting**: Token-bucket rate limiting per BB API endpoint category (general, batch, upload) — each bucket has its own burst capacity and refill rate; see `src/api/rate-limiter.ts` for exact values

## Configuration

| Environment Variable | Required | Default | Description |
|---------------------|----------|---------|-------------|
| `BB_API_CLIENT` | Yes | - | API client ID |
| `BB_API_SECRET` | Yes | - | API client secret |
| `BB_API_KEY` | Yes | - | API key |
| `BB_API_BASE_URL` | No | `https://webapp.buchhaltungsbutler.de/api/v1` | API base URL |
| `BB_RETRY_MAX_ATTEMPTS` | No | `3` | Max retry attempts on transient errors |
| `BB_RETRY_BASE_DELAY_MS` | No | `1000` | Base delay for exponential backoff (ms) |
| `BB_RETRY_MAX_DELAY_MS` | No | `8000` | Max delay cap for backoff (ms) |
| `BB_ALLOWED_FILE_DIRS` | No | - (file:// uploads disabled) | Directories from which `upload_receipt` may read local files via `file://` URLs. Separated by the platform path delimiter (`:` on Linux/macOS, `;` on Windows); a leading `~` is expanded. Paths are canonically resolved (symlinks followed) before checking, and well-known sensitive locations (`.env` files, `.ssh`/`.aws`, credential files, `/proc` etc.) are always blocked. |

## MCP Resources

The server exposes 5 MCP resources for LLM context injection:

| Resource URI | Description |
|-------------|-------------|
| `bb://accounts` | All payment/bank accounts |
| `bb://posting-accounts` | Chart of accounts (Kontenrahmen) |
| `bb://cost-locations` | All cost centers (Kostenstellen) |
| `bb://creditors/{id}` | Single creditor by posting account number |
| `bb://debtors/{id}` | Single debtor by posting account number |

Resources are read-only and benefit from the caching layer automatically.

## Future Improvements

- **DATEV export integration**: Tools for generating DATEV-compatible export files
- **MCP Prompts**: Pre-built prompts for common workflows (monthly closing, VAT reconciliation)
- **Audit logging**: Log all write operations for compliance tracking
- **Multi-tenant**: Support multiple BB accounts via dynamic credential switching
- **Response streaming**: Stream large result sets for better LLM context handling
- **Webhook support**: Listen for BB webhook events (payment received, receipt processed)
- **OAuth/token-based auth**: Support for user-level auth flows beyond Basic Auth

## Contributing

```bash
git clone https://github.com/mrvnklm/buchhaltungsbutler-mcp.git && cd buchhaltungsbutler-mcp
npm install
npm test           # vitest run
npx tsc --noEmit   # typecheck
npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide, including project structure and how to report bugs vs. security issues.

## License

MIT
