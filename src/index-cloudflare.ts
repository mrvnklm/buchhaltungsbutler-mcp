import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { loadConfig } from "./utils/config.js";
import { createServer } from "./server.js";

interface Env {
  BB_API_CLIENT?: string;
  BB_API_SECRET?: string;
  BB_API_KEY?: string;
  BB_API_BASE_URL?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/mcp") {
      return new Response("Not Found", { status: 404 });
    }

    // Client headers take priority over Worker env vars.
    //
    // IMPORTANT: BB_API_BASE_URL is only ever taken from the request when the
    // caller also supplies their own full credential set via headers. If we
    // let an unauthenticated caller override just the base URL while the
    // client/secret/key silently fall back to the operator's Worker secrets,
    // the Worker would send the operator's real BuchhaltungsButler
    // credentials (Basic auth header + api_key body param) to an
    // attacker-controlled host, exfiltrating them. Gating the base URL
    // override on the caller providing all three credential headers closes
    // that hole while preserving legitimate per-request overrides (e.g. a
    // caller using their own account + a custom base URL).
    const headers = request.headers;
    const headerClient = headers.get("x-bb-api-client");
    const headerSecret = headers.get("x-bb-api-secret");
    const headerKey = headers.get("x-bb-api-key");
    const callerSuppliedFullCredentials = Boolean(headerClient && headerSecret && headerKey);

    const configEnv: Record<string, string | undefined> = {
      BB_API_CLIENT: headerClient ?? env.BB_API_CLIENT,
      BB_API_SECRET: headerSecret ?? env.BB_API_SECRET,
      BB_API_KEY: headerKey ?? env.BB_API_KEY,
      BB_API_BASE_URL: callerSuppliedFullCredentials
        ? (headers.get("x-bb-api-base-url") ?? env.BB_API_BASE_URL)
        : env.BB_API_BASE_URL,
    };

    try {
      const config = loadConfig(configEnv);
      // NOTE: createServer() builds a fresh BbClient (and with it, a fresh
      // in-memory cache and rate limiter) on every single fetch() call, since
      // each request may carry different caller-supplied credentials via
      // headers. This is deliberate -- sharing a module-level cache/limiter
      // across requests would leak one caller's cached data or throttling
      // state to a different caller's credentials -- but it also means the
      // caching layer (src/api/cache.ts) and the rate limiter
      // (src/api/rate-limiter.ts) provide no cross-request protection on this
      // deployment target: they only apply within a single tool call. A
      // client issuing many rapid sequential requests is not locally
      // throttled here the way a long-lived stdio process would be.
      const server = createServer(config);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      await server.connect(transport);
      return await transport.handleRequest(request);
    } catch (error) {
      if (error instanceof Error && error.message.includes("Missing required")) {
        return new Response(
          `Missing credentials. Pass via headers: x-bb-api-client, x-bb-api-secret, x-bb-api-key`,
          { status: 401 }
        );
      }
      console.error("Worker request error:", error);
      throw error;
    }
  },
};
