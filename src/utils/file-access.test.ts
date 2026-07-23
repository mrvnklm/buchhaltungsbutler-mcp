import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, link, rm, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getAllowedFileDirs,
  validateReceiptFilePath,
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

  // Every rejection must be indistinguishable, otherwise the tool becomes a
  // filesystem oracle: a model driven by attacker-influenced content could probe
  // for the existence of arbitrary paths, and read back symlink targets, without
  // ever uploading anything. These tests assert the message reveals nothing.
  const OPAQUE = /Local file is not accessible/;

  async function rejectionMessage(p: string, dirs: string): Promise<string> {
    try {
      await validateReceiptFilePath(p, env(dirs));
      throw new Error("expected rejection");
    } catch (err) {
      return (err as Error).message;
    }
  }

  it("rejects a file outside the allowed directories", async () => {
    await expect(
      validateReceiptFilePath(path.join(outsideDir, "secret.pdf"), env(allowedDir))
    ).rejects.toThrow(OPAQUE);
  });

  it("rejects a symlink inside the allowed dir that points outside", async () => {
    await expect(
      validateReceiptFilePath(path.join(allowedDir, "sneaky-link.pdf"), env(allowedDir))
    ).rejects.toThrow(OPAQUE);
  });

  it("rejects .. traversal out of the allowed dir", async () => {
    const traversal = path.join(allowedDir, "..", path.basename(outsideDir), "secret.pdf");
    await expect(validateReceiptFilePath(traversal, env(allowedDir))).rejects.toThrow(OPAQUE);
  });

  it("rejects non-existent files", async () => {
    await expect(
      validateReceiptFilePath(path.join(allowedDir, "missing.pdf"), env(allowedDir))
    ).rejects.toThrow(OPAQUE);
  });

  it("rejects .env files and variants even inside an allowed dir", async () => {
    await expect(
      validateReceiptFilePath(path.join(allowedDir, ".env"), env(allowedDir))
    ).rejects.toThrow(OPAQUE);
    await expect(
      validateReceiptFilePath(path.join(allowedDir, ".env.local"), env(allowedDir))
    ).rejects.toThrow(OPAQUE);
  });

  it("rejects .ssh and .aws path segments even inside an allowed dir", async () => {
    await expect(
      validateReceiptFilePath(path.join(allowedDir, ".ssh", "id_rsa.pdf"), env(allowedDir))
    ).rejects.toThrow(OPAQUE);
    await expect(
      validateReceiptFilePath(path.join(allowedDir, ".aws", "config.pdf"), env(allowedDir))
    ).rejects.toThrow(OPAQUE);
  });

  it("rejects well-known credential filenames even inside an allowed dir", async () => {
    await expect(
      validateReceiptFilePath(path.join(allowedDir, "credentials.json"), env(allowedDir))
    ).rejects.toThrow(OPAQUE);
  });

  it("rejects restricted system locations", async () => {
    // /dev/null exists on both Linux and macOS. The blocklist runs after
    // realpath(), so a path absent on the test platform would report ENOENT and
    // never exercise it.
    await expect(validateReceiptFilePath("/dev/null", env("/dev"))).rejects.toThrow(OPAQUE);
  });

  it.runIf(process.platform === "linux")("rejects /proc paths on Linux", async () => {
    await expect(validateReceiptFilePath("/proc/version", env("/proc"))).rejects.toThrow(OPAQUE);
  });

  it("never leaks resolved paths, existence, or the allowlist in rejections", async () => {
    const missing = await rejectionMessage(path.join(allowedDir, "missing.pdf"), allowedDir);
    const denied = await rejectionMessage(path.join(outsideDir, "secret.pdf"), allowedDir);
    const symlinked = await rejectionMessage(path.join(allowedDir, "sneaky-link.pdf"), allowedDir);
    const sensitive = await rejectionMessage(path.join(allowedDir, ".env"), allowedDir);

    // Existence must not be distinguishable from denial.
    expect(denied).toBe(missing.replace("missing.pdf", "secret.pdf"));

    for (const msg of [missing, denied, symlinked, sensitive]) {
      expect(msg).not.toContain(allowedDir);
      expect(msg).not.toContain(outsideDir);
      expect(msg).not.toMatch(/does not exist|outside permitted|credentials|restricted/i);
    }
    // The symlink target must never be echoed back.
    expect(symlinked).not.toContain("secret.pdf");
  });
});

describe("known limits of path-based validation", () => {
  it("does not resolve hardlinks -- documented gap, not a regression", async () => {
    // realpath cannot distinguish a hardlink from the original file, so a
    // hardlink created inside an allowed dir passes validation and also
    // defeats the name-based blocklist (the blocklist only sees the link
    // name). Requires local write access to the allowed directory. Asserted
    // here so the limit is explicit rather than assumed away.
    const target = path.join(outsideDir, "secret.pdf");
    const hardlink = path.join(allowedDir, "hardlinked.pdf");
    try {
      await link(target, hardlink);
    } catch {
      return; // cross-device or unsupported; nothing to assert
    }

    await expect(validateReceiptFilePath(hardlink, env(allowedDir))).resolves.toContain(
      "hardlinked.pdf"
    );
    await rm(hardlink, { force: true });
  });
});
