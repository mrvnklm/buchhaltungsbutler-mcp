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

    // Client headers take priority over Worker env vars
    const headers = request.headers;
    const configEnv: Record<string, string | undefined> = {
      BB_API_CLIENT: headers.get("x-bb-api-client") ?? env.BB_API_CLIENT,
      BB_API_SECRET: headers.get("x-bb-api-secret") ?? env.BB_API_SECRET,
      BB_API_KEY: headers.get("x-bb-api-key") ?? env.BB_API_KEY,
      BB_API_BASE_URL: headers.get("x-bb-api-base-url") ?? env.BB_API_BASE_URL,
    };

    try {
      const config = loadConfig(configEnv);
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
      throw error;
    }
  },
};
