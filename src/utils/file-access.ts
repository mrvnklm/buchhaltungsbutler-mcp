import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileTypeFromBuffer } from "file-type";

/**
 * Local file access control for file:// receipt uploads, modeled after
 * workspace-mcp's validate_file_path + ALLOWED_FILE_DIRS:
 *
 * - Reads are only permitted inside directories explicitly listed in the
 *   BB_ALLOWED_FILE_DIRS env var (path.delimiter-separated). When unset,
 *   file:// uploads are disabled entirely (secure by default).
 * - Paths are canonically resolved (realpath, following symlinks) before any
 *   check, so symlink/".." escapes cannot bypass the allowlist.
 * - Well-known sensitive locations (secrets, credentials, system paths) are
 *   blocked regardless of the allowlist.
 */

export const ALLOWED_FILE_DIRS_ENV = "BB_ALLOWED_FILE_DIRS";

/** MIME types accepted for local receipt files, mirroring ALLOWED_CONTENT_TYPES. */
const ALLOWED_RECEIPT_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
]);

function expandTilde(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/**
 * Parse BB_ALLOWED_FILE_DIRS into a list of absolute directory paths.
 * Returns [] when the variable is unset or empty.
 */
export function getAllowedFileDirs(
  env: Record<string, string | undefined> = process.env
): string[] {
  const raw = env[ALLOWED_FILE_DIRS_ENV];
  if (!raw) return [];
  return raw
    .split(path.delimiter)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => path.resolve(expandTilde(p)));
}

// Blocked regardless of allowlist: system locations that expose process/kernel
// state or well-known credential files (macOS /private variants included).
const SENSITIVE_PATH_PREFIXES = [
  "/proc",
  "/sys",
  "/dev",
  "/etc/passwd",
  "/etc/shadow",
  "/private/etc/passwd",
  "/private/etc/shadow",
];

// Directory names that commonly contain credentials/keys, blocked in any
// path segment.
const SENSITIVE_DIR_SEGMENTS = new Set([".ssh", ".aws"]);

// Home-relative directories that commonly contain credentials/keys.
const SENSITIVE_HOME_DIRS = [".kube", ".gnupg", path.join(".config", "gcloud")];

// Well-known credential/secret filenames, blocked in any directory.
const SENSITIVE_FILENAMES = new Set([
  ".credentials",
  ".credentials.json",
  "credentials.json",
  "client_secret.json",
  "client_secrets.json",
  "service_account.json",
  "service-account.json",
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".git-credentials",
]);

function assertNotSensitivePath(resolved: string): void {
  const segments = resolved.split(/[\\/]+/).filter(Boolean).map((s) => s.toLowerCase());
  const fileName = path.basename(resolved).toLowerCase();

  // .env files and variants (.env, .env.local, .env.production, ...)
  if (segments.some((s) => s === ".env" || s.startsWith(".env."))) {
    throw new Error(
      `Access to '${resolved}' is not allowed: .env files may contain secrets and cannot be uploaded.`
    );
  }

  for (const prefix of SENSITIVE_PATH_PREFIXES) {
    if (resolved === prefix || resolved.startsWith(prefix + "/")) {
      throw new Error(
        `Access to '${resolved}' is not allowed: path is in a restricted system location.`
      );
    }
  }

  if (segments.some((s) => SENSITIVE_DIR_SEGMENTS.has(s))) {
    throw new Error(
      `Access to '${resolved}' is not allowed: path is in a directory that commonly contains secrets or credentials.`
    );
  }

  const home = os.homedir();
  for (const dir of SENSITIVE_HOME_DIRS) {
    const blocked = path.join(home, dir);
    if (resolved === blocked || resolved.startsWith(blocked + path.sep)) {
      throw new Error(
        `Access to '${resolved}' is not allowed: path is in a directory that commonly contains secrets or credentials.`
      );
    }
  }

  if (
    SENSITIVE_FILENAMES.has(fileName) ||
    (fileName === "config.json" && segments.includes(".docker"))
  ) {
    throw new Error(
      `Access to '${resolved}' is not allowed: this file commonly contains secrets or credentials.`
    );
  }
}

/**
 * Validate that a local file path is safe to read for a receipt upload.
 *
 * Canonically resolves the path (following symlinks), applies the sensitive-path
 * blocklist, and requires the resolved path to fall inside one of the allowed
 * directories from BB_ALLOWED_FILE_DIRS (which are also canonically resolved).
 *
 * Returns the resolved absolute path, or throws a descriptive error.
 */
export async function validateReceiptFilePath(
  rawPath: string,
  env: Record<string, string | undefined> = process.env
): Promise<string> {
  const allowedDirs = getAllowedFileDirs(env);
  if (allowedDirs.length === 0) {
    throw new Error(
      "Local file uploads via file:// URLs are disabled. " +
        `Set the ${ALLOWED_FILE_DIRS_ENV} environment variable to a list of permitted directories to enable them.`
    );
  }

  let resolved: string;
  try {
    resolved = await realpath(path.resolve(expandTilde(rawPath)));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new Error(`Local file does not exist: ${rawPath}`);
    }
    throw err;
  }

  assertNotSensitivePath(resolved);

  for (const dir of allowedDirs) {
    let resolvedDir: string;
    try {
      resolvedDir = await realpath(dir);
    } catch {
      // Configured directory doesn't exist; nothing inside it can either.
      continue;
    }
    const rel = path.relative(resolvedDir, resolved);
    if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      return resolved;
    }
  }

  throw new Error(
    `Access to '${resolved}' is not allowed: path is outside permitted directories ` +
      `(${allowedDirs.join(", ")}). Set ${ALLOWED_FILE_DIRS_ENV} to adjust.`
  );
}

/**
 * Detect the MIME type of file content via its magic bytes (using file-type)
 * and reject anything that is not PDF/PNG/JPEG (the types the BB upload
 * endpoint accepts). Content-based detection cannot be fooled by renaming a
 * file's extension.
 */
export async function detectReceiptMimeType(data: Uint8Array): Promise<string> {
  const detected = await fileTypeFromBuffer(data);
  if (!detected) {
    throw new Error(
      "Unsupported file type: no known file signature detected. Allowed: PDF, PNG, JPG"
    );
  }
  if (!ALLOWED_RECEIPT_MIME_TYPES.has(detected.mime)) {
    throw new Error(
      `Unsupported file type: ${detected.mime}. Allowed: PDF, PNG, JPG`
    );
  }
  return detected.mime;
}
