import { describe, it, expect } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  const requiredEnv = {
    BB_API_CLIENT: "client-id",
    BB_API_SECRET: "secret",
    BB_API_KEY: "key",
  };

  it("loads required config from env", () => {
    const config = loadConfig(requiredEnv);
    expect(config.apiClient).toBe("client-id");
    expect(config.apiSecret).toBe("secret");
    expect(config.apiKey).toBe("key");
    expect(config.baseUrl).toBe("https://webapp.buchhaltungsbutler.de/api/v1");
  });

  it("uses custom base URL when provided", () => {
    const config = loadConfig({ ...requiredEnv, BB_API_BASE_URL: "https://custom.api.com" });
    expect(config.baseUrl).toBe("https://custom.api.com");
  });

  it("throws when required vars are missing", () => {
    expect(() => loadConfig({})).toThrow("Missing required environment variables");
    expect(() => loadConfig({ BB_API_CLIENT: "c" })).toThrow("BB_API_SECRET");
  });

  describe("retry config", () => {
    it("does not include retry when no retry env vars set", () => {
      const config = loadConfig(requiredEnv);
      expect(config.retry).toBeUndefined();
    });

    it("reads BB_RETRY_MAX_ATTEMPTS", () => {
      const config = loadConfig({ ...requiredEnv, BB_RETRY_MAX_ATTEMPTS: "5" });
      expect(config.retry).toBeDefined();
      expect(config.retry!.maxAttempts).toBe(5);
      expect(config.retry!.baseDelayMs).toBe(1000); // default
      expect(config.retry!.maxDelayMs).toBe(8000); // default
    });

    it("reads BB_RETRY_BASE_DELAY_MS", () => {
      const config = loadConfig({ ...requiredEnv, BB_RETRY_BASE_DELAY_MS: "2000" });
      expect(config.retry!.baseDelayMs).toBe(2000);
      expect(config.retry!.maxAttempts).toBe(3); // default
    });

    it("reads BB_RETRY_MAX_DELAY_MS", () => {
      const config = loadConfig({ ...requiredEnv, BB_RETRY_MAX_DELAY_MS: "16000" });
      expect(config.retry!.maxDelayMs).toBe(16000);
    });

    it("reads all retry vars together", () => {
      const config = loadConfig({
        ...requiredEnv,
        BB_RETRY_MAX_ATTEMPTS: "5",
        BB_RETRY_BASE_DELAY_MS: "500",
        BB_RETRY_MAX_DELAY_MS: "10000",
      });
      expect(config.retry).toEqual({
        maxAttempts: 5,
        baseDelayMs: 500,
        maxDelayMs: 10000,
      });
    });
  });
});
