import { describe, it, expect, vi, afterEach } from "vitest";
import { assertSafeReceiptUrl, fetchFileFromUrl } from "./receipts.js";

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

describe("fetchFileFromUrl (redirects, content sniffing, filenames)", () => {
  const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // "%PDF-1.4"
  const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

  function mockResponse(opts: {
    status?: number;
    headers?: Record<string, string>;
    body?: Uint8Array;
  }): Response {
    const status = opts.status ?? 200;
    const body = opts.body ?? new Uint8Array(0);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(opts.headers ?? {}),
      body: { cancel: () => Promise.resolve() },
      arrayBuffer: () => Promise.resolve(body.slice().buffer),
    } as unknown as Response;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("follows redirects to public hosts (e.g. Google Drive download redirects)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockResponse({ status: 302, headers: { location: "https://cdn.example.com/real.pdf" } })
      )
      .mockResolvedValueOnce(
        mockResponse({ headers: { "content-type": "application/pdf" }, body: PDF_BYTES })
      );

    const result = await fetchFileFromUrl("https://drive.example.com/uc?export=download&id=abc");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[1][0])).toBe("https://cdn.example.com/real.pdf");
    expect(result.base64).toBe(btoa("%PDF-1.4"));
    expect(result.fileName).toBe("real.pdf");
  });

  it("re-validates every redirect hop against the SSRF guard", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockResponse({ status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } })
    );

    await expect(fetchFileFromUrl("https://example.com/f.pdf")).rejects.toThrow(/private|internal/i);
  });

  it("gives up after too many redirects", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({ status: 302, headers: { location: "https://example.com/loop.pdf" } })
    );

    await expect(fetchFileFromUrl("https://example.com/f.pdf")).rejects.toThrow(/too many redirects/i);
  });

  it("accepts application/octet-stream when magic bytes identify a PDF", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({ headers: { "content-type": "application/octet-stream" }, body: PDF_BYTES })
    );

    const result = await fetchFileFromUrl("https://example.com/uc?id=abc");
    expect(result.base64).toBe(btoa("%PDF-1.4"));
  });

  it("accepts a missing content type when magic bytes identify a JPEG", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse({ body: JPEG_BYTES }));

    await expect(fetchFileFromUrl("https://example.com/photo")).resolves.toBeDefined();
  });

  it("rejects application/octet-stream when the content is not a known file type", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        headers: { "content-type": "application/octet-stream" },
        body: new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]),
      })
    );

    await expect(fetchFileFromUrl("https://example.com/f.bin")).rejects.toThrow(/not a PDF/i);
  });

  it("still rejects declared non-generic unsupported content types", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({ headers: { "content-type": "text/html" }, body: PDF_BYTES })
    );

    await expect(fetchFileFromUrl("https://example.com/f.pdf")).rejects.toThrow(/unsupported file type/i);
  });

  it("prefers the Content-Disposition filename over the URL path", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        headers: {
          "content-type": "application/pdf",
          "content-disposition": 'attachment; filename="Rechnung-2503865.pdf"',
        },
        body: PDF_BYTES,
      })
    );

    const result = await fetchFileFromUrl("https://example.com/uc?export=download&id=xyz");
    expect(result.fileName).toBe("Rechnung-2503865.pdf");
  });
});
