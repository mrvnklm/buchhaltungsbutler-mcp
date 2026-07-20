import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getAllowedFileDirs,
  validateReceiptFilePath,
  detectReceiptMimeType,
  ALLOWED_FILE_DIRS_ENV,
} from "./file-access.js";

let allowedDir: string;
let outsideDir: string;

beforeAll(async () => {
  allowedDir = await mkdtemp(path.join(os.tmpdir(), "bb-allowed-"));
  outsideDir = await mkdtemp(path.join(os.tmpdir(), "bb-outside-"));

  await writeFile(path.join(allowedDir, "receipt.pdf"), "%PDF");
  await writeFile(path.join(outsideDir, "secret.pdf"), "%PDF");
  await symlink(
    path.join(outsideDir, "secret.pdf"),
    path.join(allowedDir, "sneaky-link.pdf")
  );

  await writeFile(path.join(allowedDir, ".env"), "SECRET=1");
  await writeFile(path.join(allowedDir, ".env.local"), "SECRET=1");
  await writeFile(path.join(allowedDir, "credentials.json"), "{}");
  await mkdir(path.join(allowedDir, ".ssh"));
  await writeFile(path.join(allowedDir, ".ssh", "id_rsa.pdf"), "key");
  await mkdir(path.join(allowedDir, ".aws"));
  await writeFile(path.join(allowedDir, ".aws", "config.pdf"), "creds");
});

afterAll(async () => {
  await rm(allowedDir, { recursive: true, force: true });
  await rm(outsideDir, { recursive: true, force: true });
});

function env(dirs?: string): Record<string, string | undefined> {
  return dirs === undefined ? {} : { [ALLOWED_FILE_DIRS_ENV]: dirs };
}

describe("getAllowedFileDirs", () => {
  it("returns [] when the env var is unset or empty", () => {
    expect(getAllowedFileDirs(env())).toEqual([]);
    expect(getAllowedFileDirs(env(""))).toEqual([]);
    expect(getAllowedFileDirs(env("  "))).toEqual([]);
  });

  it("splits on the platform path delimiter and trims entries", () => {
    const dirs = getAllowedFileDirs(env(` /a ${path.delimiter} /b ${path.delimiter}`));
    expect(dirs).toEqual([path.resolve("/a"), path.resolve("/b")]);
  });

  it("expands a leading ~ to the home directory", () => {
    const dirs = getAllowedFileDirs(env("~/receipts"));
    expect(dirs).toEqual([path.join(os.homedir(), "receipts")]);
  });
});

describe("validateReceiptFilePath", () => {
  it("rejects everything when BB_ALLOWED_FILE_DIRS is unset", async () => {
    await expect(
      validateReceiptFilePath(path.join(allowedDir, "receipt.pdf"), env())
    ).rejects.toThrow(/disabled.*BB_ALLOWED_FILE_DIRS/s);
  });

  it("accepts a file inside an allowed directory", async () => {
    const resolved = await validateReceiptFilePath(
      path.join(allowedDir, "receipt.pdf"),
      env(allowedDir)
    );
    expect(resolved).toBe(await realpath(path.join(allowedDir, "receipt.pdf")));
  });

  it("accepts a file when the allowed dir is one of several entries", async () => {
    const resolved = await validateReceiptFilePath(
      path.join(allowedDir, "receipt.pdf"),
      env(`${outsideDir}${path.delimiter}${allowedDir}`)
    );
    expect(resolved).toBe(await realpath(path.join(allowedDir, "receipt.pdf")));
  });

  it("rejects a file outside the allowed directories", async () => {
    await expect(
      validateReceiptFilePath(path.join(outsideDir, "secret.pdf"), env(allowedDir))
    ).rejects.toThrow(/outside permitted directories/);
  });

  it("rejects a symlink inside the allowed dir that points outside", async () => {
    await expect(
      validateReceiptFilePath(path.join(allowedDir, "sneaky-link.pdf"), env(allowedDir))
    ).rejects.toThrow(/outside permitted directories/);
  });

  it("rejects .. traversal out of the allowed dir", async () => {
    const traversal = path.join(
      allowedDir,
      "..",
      path.basename(outsideDir),
      "secret.pdf"
    );
    await expect(validateReceiptFilePath(traversal, env(allowedDir))).rejects.toThrow(
      /outside permitted directories/
    );
  });

  it("rejects non-existent files", async () => {
    await expect(
      validateReceiptFilePath(path.join(allowedDir, "missing.pdf"), env(allowedDir))
    ).rejects.toThrow(/does not exist/);
  });

  it("rejects .env files and variants even inside an allowed dir", async () => {
    await expect(
      validateReceiptFilePath(path.join(allowedDir, ".env"), env(allowedDir))
    ).rejects.toThrow(/\.env files/);
    await expect(
      validateReceiptFilePath(path.join(allowedDir, ".env.local"), env(allowedDir))
    ).rejects.toThrow(/\.env files/);
  });

  it("rejects .ssh and .aws path segments even inside an allowed dir", async () => {
    await expect(
      validateReceiptFilePath(path.join(allowedDir, ".ssh", "id_rsa.pdf"), env(allowedDir))
    ).rejects.toThrow(/secrets or credentials/);
    await expect(
      validateReceiptFilePath(path.join(allowedDir, ".aws", "config.pdf"), env(allowedDir))
    ).rejects.toThrow(/secrets or credentials/);
  });

  it("rejects well-known credential filenames even inside an allowed dir", async () => {
    await expect(
      validateReceiptFilePath(path.join(allowedDir, "credentials.json"), env(allowedDir))
    ).rejects.toThrow(/secrets or credentials/);
  });

  it("rejects restricted system locations", async () => {
    // The blocklist must fire before the allowlist check, even if someone
    // allowed the restricted directory itself. Uses /dev/null because it
    // exists on both Linux and macOS -- the check runs after realpath(), so a
    // path that does not exist on the test platform reports ENOENT instead and
    // would not exercise the blocklist at all.
    await expect(
      validateReceiptFilePath("/dev/null", env("/dev"))
    ).rejects.toThrow(/restricted system location/);
  });

  it.runIf(process.platform === "linux")("rejects /proc paths on Linux", async () => {
    await expect(
      validateReceiptFilePath("/proc/version", env("/proc"))
    ).rejects.toThrow(/restricted system location/);
  });
});

describe("detectReceiptMimeType", () => {
  const pdfBytes = Buffer.from("%PDF-1.4\n%%EOF");
  // PNG signature + IHDR chunk header (enough for magic detection)
  const pngBytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0x00, 0x00, 0x00, 0x0d]),
    Buffer.from("IHDR"),
    Buffer.alloc(17),
  ]);
  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);

  it("detects allowed types from magic bytes", async () => {
    await expect(detectReceiptMimeType(pdfBytes)).resolves.toBe("application/pdf");
    await expect(detectReceiptMimeType(pngBytes)).resolves.toBe("image/png");
    await expect(detectReceiptMimeType(jpegBytes)).resolves.toBe("image/jpeg");
  });

  it("rejects content without a known file signature (e.g. plain text)", async () => {
    await expect(detectReceiptMimeType(Buffer.from("just some text"))).rejects.toThrow(
      /Unsupported file type/
    );
  });

  it("rejects detectable but disallowed types", async () => {
    const gifBytes = Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00");
    await expect(detectReceiptMimeType(gifBytes)).rejects.toThrow(/image\/gif/);

    const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
    await expect(detectReceiptMimeType(zipBytes)).rejects.toThrow(/Unsupported file type/);
  });
});
