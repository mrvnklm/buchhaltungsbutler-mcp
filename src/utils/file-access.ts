import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Local file access control for file:// receipt uploads, modeled after
 * workspace-mcp's validate_file_path + ALLOWED_FILE_DIRS:
 *
 * - Reads are only permitted inside directories explicitly listed in the
 *   BB_ALLOWED_FILE_DIRS env var (path.delimiter-separated). When unset,
 *   file:// uploads are disabled entirely (secure by default).
 * - Paths are canonically resolved (realpath) before any check, so symlink
 *   and ".." escapes cannot bypass the allowlist. Hardlinks are NOT resolved
 *   by realpath and are indistinguishable from ordinary files by design, so a
 *   hardlink created inside an allowed directory does defeat both the
 *   containment guarantee and the name-based blocklist below. That requires
 *   local write access to the allowed directory.
 * - Well-known sensitive locations (secrets, credentials, system paths) are
 *   blocked regardless of the allowlist. This is best-effort defence in depth
 *   layered on the allowlist, not a boundary in its own right.
 *
 * Rejections deliberately carry no filesystem detail: this tool is driven by a
 * model whose inputs may be attacker-influenced, so a message distinguishing
 * "does not exist" from "exists but denied" -- or echoing a resolved path --
 * turns the tool into a filesystem existence and symlink-target oracle that
 * needs no local access to query. Detail goes to stderr, not to the caller.
 */

export const ALLOWED_FILE_DIRS_ENV = "BB_ALLOWED_FILE_DIRS";

/**
 * Every rejection reason collapses to this, so the caller learns only that the
 * file was not usable. The basename comes from the caller's own input, so it
 * reveals nothing they did not already supply.
 */
function accessDenied(rawPath: string, reason: string): Error {
  console.error(`[file-access] denied ${rawPath}: ${reason}`);
  return new Error(`Local file is not accessible: ${path.basename(rawPath)}`);
}

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

function sensitivePathReason(resolved: string): string | null {
  const segments = resolved.split(/[\\/]+/).filter(Boolean).map((s) => s.toLowerCase());
  const fileName = path.basename(resolved).toLowerCase();

  // .env files and variants (.env, .env.local, .env.production, ...)
  if (segments.some((s) => s === ".env" || s.startsWith(".env."))) {
    return "matches .env";
  }

  for (const prefix of SENSITIVE_PATH_PREFIXES) {
    if (resolved === prefix || resolved.startsWith(prefix + "/")) {
      return `restricted system location (${prefix})`;
    }
  }

  if (segments.some((s) => SENSITIVE_DIR_SEGMENTS.has(s))) {
    return "inside a directory that commonly holds credentials";
  }

  const home = os.homedir();
  for (const dir of SENSITIVE_HOME_DIRS) {
    const blocked = path.join(home, dir);
    if (resolved === blocked || resolved.startsWith(blocked + path.sep)) {
      return "inside a directory that commonly holds credentials";
    }
  }

  if (
    SENSITIVE_FILENAMES.has(fileName) ||
    (fileName === "config.json" && segments.includes(".docker"))
  ) {
    return "well-known credential filename";
  }

  return null;
}

/**
 * Validate that a local file path is safe to read for a receipt upload.
 *
 * Canonically resolves the path, applies the sensitive-path blocklist, and
 * requires the resolved path to fall inside one of the allowed directories
 * from BB_ALLOWED_FILE_DIRS (which are also canonically resolved).
 *
 * Returns the resolved absolute path. Every failure throws the same opaque
 * error -- see the note at the top of this file on why.
 */
export async function validateReceiptFilePath(
  rawPath: string,
  env: Record<string, string | undefined> = process.env
): Promise<string> {
  const allowedDirs = getAllowedFileDirs(env);
  if (allowedDirs.length === 0) {
    // Configuration state, not filesystem state: safe and useful to report.
    throw new Error(
      "Local file uploads via file:// URLs are disabled. " +
        `Set the ${ALLOWED_FILE_DIRS_ENV} environment variable to a list of permitted directories to enable them.`
    );
  }

  let resolved: string;
  try {
    resolved = await realpath(path.resolve(expandTilde(rawPath)));
  } catch (err) {
    // Includes ENOENT/ENOTDIR, and EINVAL for embedded NUL bytes. All collapse
    // to the same message so existence cannot be probed.
    throw accessDenied(rawPath, `realpath failed: ${(err as NodeJS.ErrnoException).code ?? "unknown"}`);
  }

  const reason = sensitivePathReason(resolved);
  if (reason) {
    throw accessDenied(rawPath, `${resolved} -- ${reason}`);
  }

  for (const dir of allowedDirs) {
    let resolvedDir: string;
    try {
      resolvedDir = await realpath(dir);
    } catch {
      // Configured directory does not exist; nothing inside it can either.
      continue;
    }
    const rel = path.relative(resolvedDir, resolved);
    if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      return resolved;
    }
  }

  throw accessDenied(rawPath, `${resolved} is outside ${allowedDirs.join(", ")}`);
}
