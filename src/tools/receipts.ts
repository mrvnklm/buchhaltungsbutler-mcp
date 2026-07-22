import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BbClient } from "../api/client.js";
import { ApiError } from "../api/errors.js";
import type { ApiResponse, BatchResponse } from "../types/common.js";
import type { ReceiptListItem, ReceiptDetail } from "../types/api-responses.js";
import { formatList, formatSingle, formatSuccess, formatBatchResult } from "../utils/formatters.js";
import { fetchAllPages, paginationCapNote } from "../utils/pagination.js";
import { dateSchema, receiptTypeSchema, listDirectionSchema, currencySchema } from "../utils/validators.js";

const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const MAX_REDIRECTS = 5;

// 3xx codes that mean "fetch it elsewhere" and carry a Location. Other 3xx
// codes (300 Multiple Choices, 304 Not Modified, the deprecated 305/306) are
// not redirects to follow and fall through to the !response.ok check instead.
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// Content types that carry no real type information; for these the actual
// file type is determined from the magic bytes instead. Hosts like Google
// Drive serve PDFs/images as application/octet-stream.
const GENERIC_CONTENT_TYPES = new Set(["application/octet-stream", "binary/octet-stream", "application/download"]);

// Cloud metadata services reachable by hostname rather than by literal IP, so
// the numeric checks below never see them. GCP's metadata.google.internal
// resolves to 169.254.169.254, which is blocked as a literal but not by name.
const BLOCKED_HOSTNAMES = new Set(["metadata.google.internal", "metadata.goog"]);

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

// PDF generators sometimes prepend a UTF-8 BOM or stray whitespace, and real
// readers scan the first 1KB for the header rather than requiring offset 0.
// PNG/JPEG signatures genuinely are at offset 0, so only PDF needs the scan.
function hasPdfHeader(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 1024);
  outer: for (let i = 0; i + PDF_MAGIC.length <= limit; i++) {
    for (let j = 0; j < PDF_MAGIC.length; j++) {
      if (bytes[i + j] !== PDF_MAGIC[j]) continue outer;
    }
    return true;
  }
  return false;
}

function sniffContentType(bytes: Uint8Array): string | null {
  if (hasPdfHeader(bytes)) {
    return "application/pdf";
  }
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
}

// The file name comes from a header chosen by the remote host -- and after a
// redirect, by whatever server the chain happens to land on. Strip any path
// component, control characters and leading dots so it cannot traverse
// directories downstream, and so it cannot smuggle newlines into the tool
// output, which is rendered back into the model's context.
function sanitizeFileName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  // Drops control characters (Cc), formatting/bidi characters (Cf, e.g. the
  // RIGHT-TO-LEFT OVERRIDE used to disguise extensions) and the Unicode line
  // and paragraph separators (Zl/Zp -- U+2028/U+2029 are line terminators and
  // would otherwise survive the C0 filter via percent-decoding).
  // Slicing happens on the code-point array so a cap can never split a
  // surrogate pair and leave ill-formed UTF-16 behind.
  const clean = [...base]
    .filter((ch) => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(ch))
    .slice(0, 255)
    .join("")
    .replace(/^\.+/, "")
    .trim();
  return clean || "receipt";
}

function fileNameFromResponse(finalUrl: URL, response: Response): string {
  const disposition = response.headers.get("content-disposition");
  if (disposition) {
    // RFC 5987/6266 extended form: filename*=charset'language'value. The
    // language tag is routinely populated (e.g. UTF-8'de'Rechnung.pdf), so it
    // has to be matched rather than assumed empty.
    const extended = disposition.match(/filename\*=\s*[^';]*'[^']*'([^;]+)/i);
    if (extended) {
      try {
        return sanitizeFileName(decodeURIComponent(extended[1].trim().replace(/^"|"$/g, "")));
      } catch {
        // malformed percent-encoding; fall through to the plain form
      }
    }
    const plain = disposition.match(/filename="?([^";]+)"?/i);
    if (plain) return sanitizeFileName(plain[1].trim());
  }
  // The final URL is redirect-controlled too, so sanitize this path as well.
  return sanitizeFileName(finalUrl.pathname.split("/").pop() ?? "");
}

function isPrivateIPv4(a: number, b: number, c: number): boolean {
  return (
    a === 127 || // loopback
    a === 10 || // RFC1918
    (a === 172 && b >= 16 && b <= 31) || // RFC1918
    (a === 192 && b === 168) || // RFC1918
    (a === 169 && b === 254) || // link-local incl. cloud metadata
    a === 0 || // "this network"
    (a === 100 && b >= 64 && b <= 127) || // RFC6598 CGNAT; incl. Alibaba metadata 100.100.100.200
    // Only 192.0.0.0/24 is reserved (RFC6890), and it holds Oracle's metadata
    // address 192.0.0.192. The rest of 192.0.0.0/16 is ordinary public space --
    // 192.0.78.0/24 is wordpress.com, 192.0.43.0/24 is iana.org.
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) || // RFC2544 benchmarking
    a >= 224 // multicast (224/4) and reserved (240/4), incl. 255.255.255.255
  );
}

// Extracts an embedded IPv4 address from IPv4-mapped (::ffff:a.b.c.d / ::ffff:7f00:1)
// or NAT64 (64:ff9b::a.b.c.d) IPv6 literals. URL parsing normalizes bracketed IPv6
// hosts into these forms, and without this the dotted-quad-only check below is
// bypassable (e.g. http://[::ffff:169.254.169.254]/ reaches the cloud metadata IP).
function extractEmbeddedIPv4(hostname: string): [number, number, number, number] | null {
  // WHATWG URL parsing normalizes IPv4-mapped/NAT64 IPv6 literals into exactly
  // these compressed prefixes (verified: "::ffff:8.8.8.8" -> "::ffff:808:808",
  // "64:ff9b::8.8.8.8" -> "64:ff9b::808:808"), so anchoring at the start is safe.
  const dottedMatch = hostname.match(/^(?:::ffff:|64:ff9b::)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i);
  if (dottedMatch) {
    const [a, b, c, d] = dottedMatch.slice(1).map(Number);
    return [a, b, c, d];
  }

  const hexMatch = hostname.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hexMatch) {
    const hi = parseInt(hexMatch[1], 16);
    const lo = parseInt(hexMatch[2], 16);
    return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff];
  }

  return null;
}

/**
 * Best-effort SSRF guard for user-supplied file URLs: only allow http(s) to
 * a public hostname/IP, blocking loopback, link-local (incl. cloud metadata
 * endpoints like 169.254.169.254), RFC1918 private ranges, and their
 * IPv4-mapped/NAT64 IPv6 equivalents (e.g. ::ffff:169.254.169.254).
 * This does not protect against DNS-rebinding (the check is on the literal
 * host, not the resolved IP), but blocks the common direct-IP/localhost cases.
 * Known residual gap: the deprecated bare IPv4-compatible IPv6 form
 * (::a.b.c.d, no ffff/NAT64 prefix) is not specially detected — after URL
 * normalization it's indistinguishable from an arbitrary compressed IPv6
 * address ending in the same two hextets, so treating it as an embedded IPv4
 * would risk false-positive blocking of legitimate IPv6 hosts. Verified this
 * is not a practical bypass: modern network stacks (including Node) no
 * longer auto-route this deprecated form to the corresponding IPv4 address.
 */
export function assertSafeReceiptUrl(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported URL scheme: ${url.protocol}`);
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("URLs pointing to localhost are not allowed");
  }

  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".metadata.google.internal")) {
    throw new Error("URLs pointing to cloud metadata endpoints are not allowed");
  }

  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [a, b, c] = ipv4Match.slice(1).map(Number);
    if (isPrivateIPv4(a, b, c)) {
      throw new Error("URLs pointing to private/internal IP addresses are not allowed");
    }
  }

  // These prefix checks only make sense for IPv6 literals, which always contain
  // a colon. Applying them to any hostname would wrongly block real domains
  // that merely start with the same letters (fdroid.org, fcbayern.de, fdp.de).
  //
  // "::" (and the "::0" spelling) is the unspecified address: connecting to it
  // reaches loopback, so it is blocked alongside "::1". fc00::/7 is unique-local,
  // fe80::/10 link-local, ff00::/8 multicast.
  if (hostname.includes(":")) {
    if (
      hostname === "::1" ||
      hostname === "::" ||
      hostname === "::0" ||
      hostname.startsWith("fe80:") ||
      hostname.startsWith("fc") ||
      hostname.startsWith("fd") ||
      hostname.startsWith("ff")
    ) {
      throw new Error("URLs pointing to private/internal IP addresses are not allowed");
    }
  }

  const embeddedIPv4 = extractEmbeddedIPv4(hostname);
  if (embeddedIPv4) {
    const [a, b, c] = embeddedIPv4;
    if (isPrivateIPv4(a, b, c)) {
      throw new Error("URLs pointing to private/internal IP addresses are not allowed");
    }
  }
}

// Releases an unread body so the underlying socket is not held until GC.
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // best effort — the connection is being abandoned anyway
  }
}

// Reads the body with a running byte cap instead of buffering it whole and
// checking afterwards: a host that omits Content-Length could otherwise stream
// arbitrarily many bytes into memory before any size check ran.
async function readBodyWithLimit(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        throw new Error(`File too large: exceeds ${limit} bytes`);
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export async function fetchFileFromUrl(url: string): Promise<{ base64: string; fileName: string }> {
  let currentUrl = new URL(url);
  assertSafeReceiptUrl(currentUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    // Follow redirects manually so every hop passes the SSRF guard — a
    // redirect from a public host to an internal address must be blocked,
    // which redirect: "follow" cannot do.
    // NB: relies on the runtime returning the real status and Location for
    // redirect: "manual" (Node/undici does). A runtime that instead returns the
    // WHATWG opaque-redirect response (status 0, headers stripped) would skip
    // this loop and surface every redirect as "Failed to fetch file: HTTP 0".
    let response = await fetch(currentUrl, { signal: controller.signal, redirect: "manual" });
    for (let hop = 0; REDIRECT_STATUSES.has(response.status); hop++) {
      if (hop >= MAX_REDIRECTS) {
        await discardBody(response);
        throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`);
      }
      const location = response.headers.get("location");
      if (!location) {
        await discardBody(response);
        throw new Error(`Redirect (HTTP ${response.status}) without Location header`);
      }
      await discardBody(response);
      currentUrl = new URL(location, currentUrl);
      assertSafeReceiptUrl(currentUrl);
      response = await fetch(currentUrl, { signal: controller.signal, redirect: "manual" });
    }

    if (!response.ok) {
      await discardBody(response);
      throw new Error(`Failed to fetch file: HTTP ${response.status}`);
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE) {
      await discardBody(response);
      throw new Error(`File too large: ${contentLength} bytes (max ${MAX_FILE_SIZE})`);
    }

    // Checked before reading the body so an unsupported type is rejected
    // without buffering up to 10MB of it first.
    const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (contentType && !ALLOWED_CONTENT_TYPES.has(contentType) && !GENERIC_CONTENT_TYPES.has(contentType)) {
      await discardBody(response);
      throw new Error(`Unsupported file type: ${contentType}. Allowed: PDF, PNG, JPG`);
    }

    const bytes = await readBodyWithLimit(response, MAX_FILE_SIZE);
    // Sniff unconditionally rather than trusting a whitelisted declared type:
    // the Content-Type is chosen by the remote host, so honouring it would let
    // any server opt out of this check by labelling arbitrary bytes
    // "application/pdf". It also rejects the common case of an HTML error page
    // served under a PDF content type by an expired or permission-denied link.
    if (!sniffContentType(bytes)) {
      throw new Error(`Unsupported file type: content is not a PDF, PNG, or JPEG (served as ${contentType ?? "unknown"})`);
    }

    // Convert to base64 using the standard Web API (btoa) rather than Node's Buffer.
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);

    return { base64, fileName: fileNameFromResponse(currentUrl, response) };
  } finally {
    clearTimeout(timeout);
  }
}

export function registerReceiptsTools(server: McpServer, client: BbClient): void {
  server.tool(
    "list_receipts",
    "List receipts (Belege) filtered by direction, dates, status, counterparty",
    {
      list_direction: listDirectionSchema.describe("'inbound' (Eingangsbelege) or 'outbound' (Ausgangsbelege)"),
      payment_status: z.enum(["paid", "unpaid"]).optional().describe("Filter by payment status"),
      counterparty: z.string().optional().describe("Filter by counterparty name"),
      date_from: dateSchema.optional().describe("Start date (YYYY-MM-DD)"),
      date_to: dateSchema.optional().describe("End date (YYYY-MM-DD)"),
      limit: z.number().int().min(1).max(500).optional().describe("Max results (1-500)"),
      offset: z.number().int().min(0).optional().describe("Offset for pagination"),
      order: z.record(z.string(), z.enum(["ASC", "DESC"])).optional().describe("Sort order, e.g. { date: 'ASC', amount: 'DESC' }"),
      include_offers: z.boolean().optional().describe("Include offers in results"),
      deleted: z.boolean().optional().describe("Include deleted receipts"),
      invoicenumber: z.string().optional().describe("Filter by invoice number"),
      due_date: dateSchema.optional().describe("Filter by due date (YYYY-MM-DD)"),
      auto_paginate: z.boolean().optional().describe("Fetch all pages automatically (default: false)"),
      max_results: z.number().int().min(1).optional().describe("Maximum number of results to return in the response"),
    },
    async (params) => {
      try {
        const requestParams: Record<string, unknown> = {
          list_direction: params.list_direction,
        };
        if (params.payment_status !== undefined) requestParams.payment_status = params.payment_status;
        if (params.counterparty !== undefined) requestParams.counterparty = params.counterparty;
        if (params.date_from !== undefined) requestParams.date_from = params.date_from;
        if (params.date_to !== undefined) requestParams.date_to = params.date_to;
        if (params.limit !== undefined) requestParams.limit = params.limit;
        if (params.offset !== undefined) requestParams.offset = params.offset;
        if (params.order !== undefined) requestParams.order = params.order;
        if (params.include_offers !== undefined) requestParams.include_offers = params.include_offers;
        if (params.deleted !== undefined) requestParams.deleted = params.deleted;
        if (params.invoicenumber !== undefined) requestParams.invoicenumber = params.invoicenumber;
        if (params.due_date !== undefined) requestParams.due_date = params.due_date;

        let data: ReceiptListItem[];
        let totalRows: number | undefined;
        let paginationNote: string | undefined;

        if (params.auto_paginate) {
          const result = await fetchAllPages<ReceiptListItem>(client, "/receipts/get", requestParams, { pageSize: 500 });
          data = result.data;
          totalRows = result.totalRows;
          if (result.hasMore) paginationNote = paginationCapNote(result.pagesLoaded);
        } else {
          const res = await client.request<ApiResponse<ReceiptListItem[]>>("/receipts/get", requestParams);
          data = res.data ?? [];
          totalRows = res.rows;
        }

        return {
          content: [{
            type: "text" as const,
            text: formatList("Receipts", data, totalRows,
              { maxItems: params.max_results, note: paginationNote }),
          }],
        };
      } catch (error) {
        if (error instanceof ApiError) {
          return {
            content: [{ type: "text" as const, text: error.toText() }],
            isError: true,
          };
        }
        throw error;
      }
    }
  );

  server.tool(
    "get_receipt",
    "Get a single receipt by its ID, optionally including the file content",
    {
      id_by_customer: z.string().describe("Receipt ID (id_by_customer)"),
      get_file: z.boolean().optional().describe("Include base64-encoded file content in response"),
    },
    async (params) => {
      try {
        const requestParams: Record<string, unknown> = {};
        if (params.get_file !== undefined) requestParams.get_file = params.get_file;

        const res = await client.request<ApiResponse<ReceiptDetail>>(
          `/receipts/get/${params.id_by_customer}`,
          requestParams
        );
        return {
          content: [{
            type: "text" as const,
            text: formatSingle("Receipt", res.data ?? {}),
          }],
        };
      } catch (error) {
        if (error instanceof ApiError) {
          return {
            content: [{ type: "text" as const, text: error.toText() }],
            isError: true,
          };
        }
        throw error;
      }
    }
  );

  const receiptFields = {
    type: receiptTypeSchema.describe("Receipt type"),
    counterparty: z.string().describe("Counterparty name"),
    invoice_number: z.string().describe("Invoice number"),
    date: dateSchema.describe("Receipt date (YYYY-MM-DD)"),
    amount: z.number().describe("Amount"),
    currency: currencySchema.describe("Currency code"),
    vat_rate: z.number().optional().describe("VAT rate percentage"),
    account: z.number().int().optional().describe("Payment account ID"),
    creditor_debtor: z.number().int().optional().describe("Creditor/debtor ID"),
    payment_reference: z.string().optional().describe("Payment reference"),
    date_delivery: dateSchema.optional().describe("Delivery date (YYYY-MM-DD)"),
    date_payment_due: dateSchema.optional().describe("Payment due date (YYYY-MM-DD)"),
    link_to_receipt_id_by_customer: z.number().int().optional().describe("Link to another receipt ID"),
  };

  server.tool(
    "create_receipt",
    "Create one or multiple receipts. Pass a single receipt's fields directly, or a 'receipts' array (max 50) for batch creation",
    {
      // Single receipt fields
      type: receiptTypeSchema.optional().describe("Receipt type (required for single)"),
      counterparty: z.string().optional().describe("Counterparty name (required for single)"),
      invoice_number: z.string().optional().describe("Invoice number (required for single)"),
      date: dateSchema.optional().describe("Receipt date YYYY-MM-DD (required for single)"),
      amount: z.number().optional().describe("Amount (required for single)"),
      currency: currencySchema.optional().describe("Currency code (required for single)"),
      vat_rate: z.number().optional().describe("VAT rate percentage"),
      account: z.number().int().optional().describe("Payment account ID"),
      creditor_debtor: z.number().int().optional().describe("Creditor/debtor ID"),
      payment_reference: z.string().optional().describe("Payment reference"),
      date_delivery: dateSchema.optional().describe("Delivery date (YYYY-MM-DD)"),
      date_payment_due: dateSchema.optional().describe("Payment due date (YYYY-MM-DD)"),
      link_to_receipt_id_by_customer: z.number().int().optional().describe("Link to another receipt ID"),
      // Batch
      receipts: z.array(z.object(receiptFields)).max(50).optional().describe("Array of receipts for batch creation (max 50)"),
    },
    async (params) => {
      try {
        if (params.receipts !== undefined && params.receipts.length > 0) {
          // Batch creation
          const res = await client.request<BatchResponse>(
            "/receipts/addBatch",
            { receipts: params.receipts },
            "batch"
          );
          // Per the API's Swagger schema, `receipts` only ever contains successful
          // items (success is fixed `true`); failures live in the separate `errors`
          // array, not mixed into `receipts` -- filtering `receipts` for
          // success===false always yields [] and silently drops real errors.
          const successes = ((res as Record<string, unknown>).receipts ?? []) as Record<string, unknown>[];
          const errors = res.errors ?? [];
          return {
            content: [{
              type: "text" as const,
              text: formatBatchResult("Batch receipt creation", successes, errors),
            }],
          };
        }

        // Single creation - validate required fields
        if (!params.type || !params.counterparty || !params.invoice_number || !params.date || params.amount === undefined || !params.currency) {
          return {
            content: [{ type: "text" as const, text: "Error: type, counterparty, invoice_number, date, amount, and currency are required for single receipt creation" }],
            isError: true,
          };
        }

        const requestParams: Record<string, unknown> = {
          type: params.type,
          counterparty: params.counterparty,
          invoice_number: params.invoice_number,
          date: params.date,
          amount: params.amount,
          currency: params.currency,
        };
        if (params.vat_rate !== undefined) requestParams.vat_rate = params.vat_rate;
        if (params.account !== undefined) requestParams.account = params.account;
        if (params.creditor_debtor !== undefined) requestParams.creditor_debtor = params.creditor_debtor;
        if (params.payment_reference !== undefined) requestParams.payment_reference = params.payment_reference;
        if (params.date_delivery !== undefined) requestParams.date_delivery = params.date_delivery;
        if (params.date_payment_due !== undefined) requestParams.date_payment_due = params.date_payment_due;
        if (params.link_to_receipt_id_by_customer !== undefined) requestParams.link_to_receipt_id_by_customer = params.link_to_receipt_id_by_customer;

        const res = await client.request<ApiResponse>("/receipts/add", requestParams);
        return {
          content: [{
            type: "text" as const,
            text: formatSuccess(res.message ?? "Receipt created", {
              counterparty: params.counterparty,
              invoice_number: params.invoice_number,
              amount: params.amount,
              currency: params.currency,
            }),
          }],
        };
      } catch (error) {
        if (error instanceof ApiError) {
          return {
            content: [{ type: "text" as const, text: error.toText() }],
            isError: true,
          };
        }
        throw error;
      }
    }
  );

  server.tool(
    "upload_receipt",
    "Upload a receipt file (base64-encoded or from URL) with optional metadata",
    {
      file: z.string().optional().describe("Base64-encoded file content (provide this OR file_url)"),
      file_url: z.url().optional().describe("URL to fetch the receipt file from (alternative to base64 file). Supports PDF, PNG, JPG up to 10MB."),
      type: receiptTypeSchema.describe("Receipt type"),
      file_name: z.string().optional().describe("File name (recommended for base64 uploads)"),
      account: z.number().int().optional().describe("Payment account ID"),
      creditor_debtor: z.number().int().optional().describe("Creditor/debtor ID"),
      counterparty: z.string().optional().describe("Counterparty name"),
      invoice_number: z.string().optional().describe("Invoice number"),
      date: dateSchema.optional().describe("Receipt date (YYYY-MM-DD)"),
      amount: z.number().optional().describe("Amount"),
      // The BB API docs for /receipts/upload state currency "has to be 'EUR' if
      // specified" -- unlike create_receipt/create_transaction, this endpoint does
      // not accept foreign currencies, so we enforce that locally instead of
      // letting an otherwise-valid-looking currency fail server-side.
      currency: z.literal("EUR").optional().describe("Currency code -- must be 'EUR' if specified (this endpoint does not support foreign currencies)"),
      vat_rate: z.number().optional().describe("VAT rate percentage"),
      payment_reference: z.string().optional().describe("Payment reference"),
      date_delivery: dateSchema.optional().describe("Delivery date (YYYY-MM-DD)"),
      date_payment_due: dateSchema.optional().describe("Payment due date (YYYY-MM-DD)"),
      link_to_receipt_id_by_customer: z.number().int().optional().describe("Link to another receipt ID"),
    },
    async (params) => {
      try {
        // Validate exactly one of file or file_url
        if (!params.file && !params.file_url) {
          return {
            content: [{ type: "text" as const, text: "Error: Either 'file' (base64) or 'file_url' must be provided" }],
            isError: true,
          };
        }
        if (params.file && params.file_url) {
          return {
            content: [{ type: "text" as const, text: "Error: Provide either 'file' or 'file_url', not both" }],
            isError: true,
          };
        }

        let fileContent = params.file!;
        let fileName = params.file_name;

        if (params.file_url) {
          try {
            const fetched = await fetchFileFromUrl(params.file_url);
            fileContent = fetched.base64;
            if (!fileName) fileName = fetched.fileName;
          } catch (err) {
            return {
              content: [{ type: "text" as const, text: `Error fetching file from URL: ${err instanceof Error ? err.message : String(err)}` }],
              isError: true,
            };
          }
        }

        const requestParams: Record<string, unknown> = {
          file: fileContent,
          type: params.type,
        };
        if (fileName !== undefined) requestParams.file_name = fileName;
        if (params.account !== undefined) requestParams.account = params.account;
        if (params.creditor_debtor !== undefined) requestParams.creditor_debtor = params.creditor_debtor;
        if (params.counterparty !== undefined) requestParams.counterparty = params.counterparty;
        if (params.invoice_number !== undefined) requestParams.invoice_number = params.invoice_number;
        if (params.date !== undefined) requestParams.date = params.date;
        if (params.amount !== undefined) requestParams.amount = params.amount;
        if (params.currency !== undefined) requestParams.currency = params.currency;
        if (params.vat_rate !== undefined) requestParams.vat_rate = params.vat_rate;
        if (params.payment_reference !== undefined) requestParams.payment_reference = params.payment_reference;
        if (params.date_delivery !== undefined) requestParams.date_delivery = params.date_delivery;
        if (params.date_payment_due !== undefined) requestParams.date_payment_due = params.date_payment_due;
        if (params.link_to_receipt_id_by_customer !== undefined) requestParams.link_to_receipt_id_by_customer = params.link_to_receipt_id_by_customer;

        const res = await client.request<ApiResponse>("/receipts/upload", requestParams, "upload");
        return {
          content: [{
            type: "text" as const,
            text: formatSuccess(res.message ?? "Receipt uploaded", {
              file_name: fileName,
              type: params.type,
              counterparty: params.counterparty,
            }),
          }],
        };
      } catch (error) {
        if (error instanceof ApiError) {
          return {
            content: [{ type: "text" as const, text: error.toText() }],
            isError: true,
          };
        }
        throw error;
      }
    }
  );

  server.tool(
    "manage_receipt",
    "Delete or restore a receipt",
    {
      action: z.enum(["delete", "restore"]).describe("Action to perform"),
      id_by_customer: z.string().describe("Receipt ID (id_by_customer)"),
    },
    async (params) => {
      try {
        const path = params.action === "delete"
          ? `/receipts/delete/${params.id_by_customer}`
          : `/receipts/restore/${params.id_by_customer}`;

        const res = await client.request<ApiResponse>(path);
        return {
          content: [{
            type: "text" as const,
            text: formatSuccess(res.message ?? `Receipt ${params.action}d`, {
              id_by_customer: params.id_by_customer,
              action: params.action,
            }),
          }],
        };
      } catch (error) {
        if (error instanceof ApiError) {
          return {
            content: [{ type: "text" as const, text: error.toText() }],
            isError: true,
          };
        }
        throw error;
      }
    }
  );
}
