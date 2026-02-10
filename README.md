# BuchhaltungsButler MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green)](https://nodejs.org/)

An MCP (Model Context Protocol) server that connects AI assistants like Claude to the [BuchhaltungsButler](https://www.buchhaltungsbutler.de/) German accounting API. Manage receipts, transactions, invoices, postings, and more through natural language.

## Features

- **25 tools** covering the full BuchhaltungsButler API surface
- **5 MCP resources** for context injection (accounts, posting accounts, cost locations, creditors, debtors)
- **Batch operations** for receipts, transactions, postings, debtors, and creditors (up to 50 items)
- **Retry with backoff** on transient errors (rate limit, timeout, network failure) with configurable attempts
- **Caching layer** for static endpoints (accounts, posting accounts, cost locations) with TTL and write-triggered invalidation
- **Auto-pagination** fetches all pages automatically via `auto_paginate` parameter on list tools
- **Response truncation** with configurable `max_results` to prevent token overflow on large result sets
- **File upload from URL** in `upload_receipt` — accepts a URL, fetches server-side with content-type and size validation
- **Rate limiting** with per-bucket throttling (general, batch, upload)
- **E-invoicing** support (XRechnung/ZUGFeRD) with structured tax data
- **Cloudflare Workers** deployment via Streamable HTTP transport
- **Zod validation** on all tool inputs with descriptive error messages
- **LLM-friendly output** formatting for structured, readable responses

## Quick Start

### Prerequisites

You need BuchhaltungsButler API credentials:
- `BB_API_CLIENT` - API client ID
- `BB_API_SECRET` - API client secret
- `BB_API_KEY` - API key for your account

These are available in your BuchhaltungsButler account under Settings > API.

### Install & Run

```bash
npm install
npm run build
```

### Claude Desktop Configuration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "buchhaltungsbutler": {
      "command": "node",
      "args": ["/path/to/buchhaltungsbutler-mcp/dist/index.js"],
      "env": {
        "BB_API_CLIENT": "your-api-client",
        "BB_API_SECRET": "your-api-secret",
        "BB_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Cloudflare Workers Deployment

The server can also run as a Cloudflare Worker using the Streamable HTTP transport for remote access.

### Setup

```bash
# Set your API credentials as Worker secrets
npx wrangler secret put BB_API_CLIENT
npx wrangler secret put BB_API_SECRET
npx wrangler secret put BB_API_KEY

# Deploy
npm run deploy
```

### Local Development

Create a `.dev.vars` file with your credentials:

```
BB_API_CLIENT=your-api-client
BB_API_SECRET=your-api-secret
BB_API_KEY=your-api-key
```

Then run:

```bash
npm run start:cf
```

The MCP endpoint will be available at `http://localhost:8787/mcp`.

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
| `upload_receipt` | Upload a receipt file (base64 or URL) with optional metadata |
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
  index-cloudflare.ts      # Cloudflare Workers entry point
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

- **POST-only API**: BuchhaltungsButler uses POST for all endpoints with `x-www-form-urlencoded` bodies and Basic Auth
- **Consolidated tools**: Related CRUD operations (e.g., list/add/update/delete) are combined into single tools with an `action` parameter to reduce tool count
- **Batch support**: Tools that support batch operations accept either single-item fields or an array, automatically routing to the correct API endpoint
- **Rate limiting**: Three buckets (general: 2/sec, batch: 1/2sec, upload: 1/5sec) matching BB API limits
- **Stateless Workers**: The Cloudflare Workers deployment creates a fresh server+transport per request, which is correct for the stateless MCP Streamable HTTP mode

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

## License

MIT
