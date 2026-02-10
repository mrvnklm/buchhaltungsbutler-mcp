import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { loadConfig } from "./utils/config.js";
import { createServer } from "./server.js";

interface Env {
  BB_API_CLIENT: string;
  BB_API_SECRET: string;
  BB_API_KEY: string;
  BB_API_BASE_URL?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/mcp") {
      return new Response("Not Found", { status: 404 });
    }

    const config = loadConfig(env as unknown as Record<string, string>);
    const server = createServer(config);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);
    const response = await transport.handleRequest(request);
    return response;
  },
};
