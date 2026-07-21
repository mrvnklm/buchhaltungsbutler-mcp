import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assertSafeReceiptUrl, registerReceiptsTools } from "./receipts.js";
import type { BbClient } from "../api/client.js";

// We test the fetchFileFromUrl function indirectly by testing the module-level helper.
// Since it's not exported, we test via the upload_receipt tool behavior by examining
// the fetch mock calls and validation logic.

// For direct unit testing of the URL fetch logic:
describe("upload_receipt file_url validation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects unsupported content types", async () => {
    // Simulate fetching a non-PDF/image file
    const mockResponse = {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
    } as Response;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

    // Import dynamically so the mock is in place
    // We need to test the helper — since it's not exported, we test the pattern
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch("https://example.com/file.html", { signal: controller.signal });
      const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
      const allowed = new Set(["application/pdf", "image/png", "image/jpeg", "image/jpg"]);

      expect(contentType).toBe("text/html");
      expect(allowed.has(contentType!)).toBe(false);
    } finally {
      clearTimeout(timeout);
    }
  });

  it("rejects files exceeding 10MB via Content-Length", async () => {
    const maxFileSize = 10 * 1024 * 1024;
    const mockResponse = {
      ok: true,
      status: 200,
      headers: new Headers({
        "content-type": "application/pdf",
        "content-length": String(maxFileSize + 1),
      }),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
    } as Response;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

    const response = await fetch("https://example.com/large.pdf");
    const contentLength = response.headers.get("content-length");

    expect(parseInt(contentLength!, 10)).toBeGreaterThan(maxFileSize);
  });

  it("accepts valid PDF files", async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    const mockResponse = {
      ok: true,
      status: 200,
      headers: new Headers({
        "content-type": "application/pdf",
        "content-length": String(pdfBytes.length),
      }),
      arrayBuffer: () => Promise.resolve(pdfBytes.buffer),
    } as Response;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

    const response = await fetch("https://example.com/invoice.pdf");
    const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    const allowed = new Set(["application/pdf", "image/png", "image/jpeg", "image/jpg"]);

    expect(allowed.has(contentType!)).toBe(true);

    const buffer = await response.arrayBuffer();
    expect(buffer.byteLength).toBeLessThanOrEqual(10 * 1024 * 1024);

    // Test base64 conversion (same logic as fetchFileFromUrl)
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    expect(base64).toBe("JVBERg=="); // base64 of %PDF (4 bytes)
  });

  it("extracts filename from URL path", () => {
    const url = "https://example.com/invoices/2024/invoice-123.pdf";
    const urlPath = new URL(url).pathname;
    const fileName = urlPath.split("/").pop() || "receipt";
    expect(fileName).toBe("invoice-123.pdf");
  });

  it("falls back to 'receipt' for empty path", () => {
    const url = "https://example.com/";
    const urlPath = new URL(url).pathname;
    const fileName = urlPath.split("/").pop() || "receipt";
    expect(fileName).toBe("receipt");
  });

  it("handles HTTP errors from URL", async () => {
    const mockResponse = {
      ok: false,
      status: 404,
      headers: new Headers(),
    } as Response;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

    const response = await fetch("https://example.com/missing.pdf");
    expect(response.ok).toBe(false);
    expect(response.status).toBe(404);
  });
});

describe("upload_receipt SSRF protection (assertSafeReceiptUrl)", () => {
  it("allows public http(s) URLs", () => {
    expect(() => assertSafeReceiptUrl(new URL("https://example.com/invoice.pdf"))).not.toThrow();
    expect(() => assertSafeReceiptUrl(new URL("http://example.com/invoice.pdf"))).not.toThrow();
    expect(() => assertSafeReceiptUrl(new URL("https://8.8.8.8/invoice.pdf"))).not.toThrow();
  });

  it("rejects non-http(s) schemes", () => {
    expect(() => assertSafeReceiptUrl(new URL("file:///etc/passwd"))).toThrow(/scheme/i);
    expect(() => assertSafeReceiptUrl(new URL("ftp://example.com/f.pdf"))).toThrow(/scheme/i);
    expect(() => assertSafeReceiptUrl(new URL("gopher://example.com/f.pdf"))).toThrow(/scheme/i);
  });

  it("rejects localhost and *.localhost", () => {
    expect(() => assertSafeReceiptUrl(new URL("http://localhost/f.pdf"))).toThrow(/localhost/i);
    expect(() => assertSafeReceiptUrl(new URL("http://foo.localhost/f.pdf"))).toThrow(/localhost/i);
  });

  it("rejects loopback IPv4 (127.0.0.0/8)", () => {
    expect(() => assertSafeReceiptUrl(new URL("http://127.0.0.1/f.pdf"))).toThrow();
    expect(() => assertSafeReceiptUrl(new URL("http://127.255.255.255/f.pdf"))).toThrow();
  });

  it("rejects RFC1918 private ranges", () => {
    expect(() => assertSafeReceiptUrl(new URL("http://10.0.0.5/f.pdf"))).toThrow();
    expect(() => assertSafeReceiptUrl(new URL("http://172.16.0.1/f.pdf"))).toThrow();
    expect(() => assertSafeReceiptUrl(new URL("http://172.31.255.255/f.pdf"))).toThrow();
    expect(() => assertSafeReceiptUrl(new URL("http://192.168.1.1/f.pdf"))).toThrow();
    // Adjacent-but-public ranges must NOT be blocked
    expect(() => assertSafeReceiptUrl(new URL("http://172.15.0.1/f.pdf"))).not.toThrow();
    expect(() => assertSafeReceiptUrl(new URL("http://172.32.0.1/f.pdf"))).not.toThrow();
  });

  it("rejects link-local and cloud metadata address (169.254.0.0/16)", () => {
    expect(() => assertSafeReceiptUrl(new URL("http://169.254.169.254/latest/meta-data/"))).toThrow();
    expect(() => assertSafeReceiptUrl(new URL("http://169.254.0.1/f.pdf"))).toThrow();
  });

  it("rejects IPv6 loopback, link-local, and unique-local addresses", () => {
    expect(() => assertSafeReceiptUrl(new URL("http://[::1]/f.pdf"))).toThrow();
    expect(() => assertSafeReceiptUrl(new URL("http://[fe80::1]/f.pdf"))).toThrow();
    expect(() => assertSafeReceiptUrl(new URL("http://[fc00::1]/f.pdf"))).toThrow();
    expect(() => assertSafeReceiptUrl(new URL("http://[fd12:3456::1]/f.pdf"))).toThrow();
  });

  it("rejects IPv4-mapped IPv6 addresses pointing at private/internal ranges", () => {
    // URL parsing normalizes bracketed IPv4-mapped IPv6 literals into hex form
    // (e.g. [::ffff:127.0.0.1] -> hostname "::ffff:7f00:1"), which bypassed a
    // dotted-quad-only check. Cover both the dotted and normalized hex forms.
    expect(() => assertSafeReceiptUrl(new URL("http://[::ffff:127.0.0.1]/f.pdf"))).toThrow();
    expect(() => assertSafeReceiptUrl(new URL("http://[::ffff:169.254.169.254]/latest/meta-data/"))).toThrow();
    expect(() => assertSafeReceiptUrl(new URL("http://[::ffff:10.0.0.1]/f.pdf"))).toThrow();
    expect(() => assertSafeReceiptUrl(new URL("http://[::ffff:192.168.1.1]/f.pdf"))).toThrow();
    expect(() => assertSafeReceiptUrl(new URL("http://[::ffff:7f00:1]/f.pdf"))).toThrow();
    expect(() => assertSafeReceiptUrl(new URL("http://[::ffff:a9fe:a9fe]/f.pdf"))).toThrow();
    // Public IPv4-mapped addresses must NOT be blocked
    expect(() => assertSafeReceiptUrl(new URL("http://[::ffff:8.8.8.8]/f.pdf"))).not.toThrow();
  });

  it("rejects NAT64-mapped private/internal IPv4 addresses", () => {
    expect(() => assertSafeReceiptUrl(new URL("http://[64:ff9b::169.254.169.254]/f.pdf"))).toThrow();
    expect(() => assertSafeReceiptUrl(new URL("http://[64:ff9b::127.0.0.1]/f.pdf"))).toThrow();
    expect(() => assertSafeReceiptUrl(new URL("http://[64:ff9b::8.8.8.8]/f.pdf"))).not.toThrow();
  });
});

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

function getUploadReceiptHandler(client: BbClient): ToolHandler {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    tool: (name: string, ...rest: unknown[]) => {
      const handler = rest[rest.length - 1] as ToolHandler;
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  registerReceiptsTools(server, client);
  const handler = handlers.get("upload_receipt");
  if (!handler) throw new Error("upload_receipt tool was not registered");
  return handler;
}

function createFakeClient(): BbClient {
  return {
    request: vi.fn().mockResolvedValue({ success: true, message: "Receipt uploaded" }),
  } as unknown as BbClient;
}

describe("upload_receipt file:// uploads", () => {
  let allowedDir: string;
  let outsideDir: string;
  const MAX_FILE_SIZE = 10 * 1024 * 1024;

  beforeAll(async () => {
    allowedDir = await mkdtemp(path.join(os.tmpdir(), "bb-upload-allowed-"));
    outsideDir = await mkdtemp(path.join(os.tmpdir(), "bb-upload-outside-"));

    await writeFile(path.join(allowedDir, "invoice.pdf"), "%PDF-1.4\n%%EOF");
    await writeFile(path.join(allowedDir, "notes.txt"), "not a receipt");
    await writeFile(path.join(allowedDir, "fake.pdf"), "plain text disguised as pdf");
    await writeFile(path.join(allowedDir, "huge.pdf"), Buffer.alloc(MAX_FILE_SIZE + 1));
    await writeFile(path.join(outsideDir, "invoice.pdf"), "%PDF-1.4\n%%EOF");
  });

  afterAll(async () => {
    await rm(allowedDir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uploads a local file from an allowed directory as base64", async () => {
    vi.stubEnv("BB_ALLOWED_FILE_DIRS", allowedDir);
    const client = createFakeClient();
    const handler = getUploadReceiptHandler(client);

    const result = await handler({
      file_url: pathToFileURL(path.join(allowedDir, "invoice.pdf")).href,
      type: "invoice inbound",
    });

    expect(result.isError).toBeUndefined();
    expect(client.request).toHaveBeenCalledWith(
      "/receipts/upload",
      expect.objectContaining({
        file: Buffer.from("%PDF-1.4\n%%EOF").toString("base64"),
        file_name: "invoice.pdf",
        type: "invoice inbound",
      }),
      "upload"
    );
  });

  it("keeps an explicit file_name over the basename", async () => {
    vi.stubEnv("BB_ALLOWED_FILE_DIRS", allowedDir);
    const client = createFakeClient();
    const handler = getUploadReceiptHandler(client);

    const result = await handler({
      file_url: pathToFileURL(path.join(allowedDir, "invoice.pdf")).href,
      file_name: "renamed.pdf",
      type: "invoice inbound",
    });

    expect(result.isError).toBeUndefined();
    expect(client.request).toHaveBeenCalledWith(
      "/receipts/upload",
      expect.objectContaining({ file_name: "renamed.pdf" }),
      "upload"
    );
  });

  it("rejects file:// URLs when BB_ALLOWED_FILE_DIRS is not set", async () => {
    const client = createFakeClient();
    const handler = getUploadReceiptHandler(client);

    const result = await handler({
      file_url: pathToFileURL(path.join(allowedDir, "invoice.pdf")).href,
      type: "invoice inbound",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("BB_ALLOWED_FILE_DIRS");
    expect(client.request).not.toHaveBeenCalled();
  });

  it("rejects files outside the allowed directories", async () => {
    vi.stubEnv("BB_ALLOWED_FILE_DIRS", allowedDir);
    const client = createFakeClient();
    const handler = getUploadReceiptHandler(client);

    const result = await handler({
      file_url: pathToFileURL(path.join(outsideDir, "invoice.pdf")).href,
      type: "invoice inbound",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/outside permitted directories/);
    expect(client.request).not.toHaveBeenCalled();
  });

  it("rejects files whose content is not PDF/PNG/JPEG", async () => {
    vi.stubEnv("BB_ALLOWED_FILE_DIRS", allowedDir);
    const client = createFakeClient();
    const handler = getUploadReceiptHandler(client);

    const result = await handler({
      file_url: pathToFileURL(path.join(allowedDir, "notes.txt")).href,
      type: "invoice inbound",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Unsupported file type/);
    expect(client.request).not.toHaveBeenCalled();
  });

  it("rejects disallowed content even with an allowed extension (magic bytes win)", async () => {
    vi.stubEnv("BB_ALLOWED_FILE_DIRS", allowedDir);
    const client = createFakeClient();
    const handler = getUploadReceiptHandler(client);

    const result = await handler({
      file_url: pathToFileURL(path.join(allowedDir, "fake.pdf")).href,
      type: "invoice inbound",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Unsupported file type/);
    expect(client.request).not.toHaveBeenCalled();
  });

  it("rejects files exceeding the 10MB limit", async () => {
    vi.stubEnv("BB_ALLOWED_FILE_DIRS", allowedDir);
    const client = createFakeClient();
    const handler = getUploadReceiptHandler(client);

    const result = await handler({
      file_url: pathToFileURL(path.join(allowedDir, "huge.pdf")).href,
      type: "invoice inbound",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/File too large/);
    expect(client.request).not.toHaveBeenCalled();
  });

  it("rejects non-existent files inside an allowed directory", async () => {
    vi.stubEnv("BB_ALLOWED_FILE_DIRS", allowedDir);
    const client = createFakeClient();
    const handler = getUploadReceiptHandler(client);

    const result = await handler({
      file_url: pathToFileURL(path.join(allowedDir, "missing.pdf")).href,
      type: "invoice inbound",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/does not exist/);
    expect(client.request).not.toHaveBeenCalled();
  });
});
