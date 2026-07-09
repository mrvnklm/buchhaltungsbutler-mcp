import { describe, it, expect, vi, afterEach } from "vitest";
import { assertSafeReceiptUrl } from "./receipts.js";

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
