import type { BbConfig } from "../types/common.js";

export function loadConfig(env?: Record<string, string | undefined>): BbConfig {
  const get = (key: string): string | undefined =>
    env ? env[key] : process.env[key];

  const apiClient = get("BB_API_CLIENT");
  const apiSecret = get("BB_API_SECRET");
  const apiKey = get("BB_API_KEY");

  if (!apiClient || !apiSecret || !apiKey) {
    const missing = [
      !apiClient && "BB_API_CLIENT",
      !apiSecret && "BB_API_SECRET",
      !apiKey && "BB_API_KEY",
    ].filter(Boolean);
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  return {
    apiClient,
    apiSecret,
    apiKey,
    baseUrl: get("BB_API_BASE_URL") ?? "https://webapp.buchhaltungsbutler.de/api/v1",
  };
}
