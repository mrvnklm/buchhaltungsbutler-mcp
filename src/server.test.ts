import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "./server.js";

// createServer resolves its reported version from package.json one directory
// above the compiled server, and swallows any failure into a placeholder. That
// makes a broken path assumption silent -- it would only surface as a wrong
// version in an MCP client handshake. Assert it here instead.
describe("createServer version reporting", () => {
  const config = {
    apiClient: "test-client",
    apiSecret: "test-secret",
    apiKey: "test-key",
    baseUrl: "https://example.invalid",
  };

  function packageVersion(): string {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string };
    return pkg.version;
  }

  // The SDK keeps serverInfo private; this reads it back the way a client sees it.
  function reportedVersion(server: ReturnType<typeof createServer>): string {
    const info = (server.server as unknown as { _serverInfo: { name: string; version: string } })._serverInfo;
    return info.version;
  }

  it("reports the version from package.json, not the fallback", () => {
    const version = reportedVersion(createServer(config));

    expect(version).not.toBe("0.0.0-unknown");
    expect(version).toBe(packageVersion());
  });

  it("reports a valid semver version", () => {
    expect(reportedVersion(createServer(config))).toMatch(/^\d+\.\d+\.\d+/);
  });
});
