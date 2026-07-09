import { describe, it, expect, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTransactionsTools } from "./transactions.js";
import type { BbClient } from "../api/client.js";

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

function createFakeServer(): { server: McpServer; handlers: Map<string, ToolHandler> } {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    tool: (name: string, ...rest: unknown[]) => {
      const handler = rest[rest.length - 1] as ToolHandler;
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  return { server, handlers };
}

function createFakeClient(response: unknown): BbClient {
  return {
    request: vi.fn().mockResolvedValue(response),
  } as unknown as BbClient;
}

function getCreateTransactionHandler(client: BbClient): ToolHandler {
  const { server, handlers } = createFakeServer();
  registerTransactionsTools(server, client);
  const handler = handlers.get("create_transaction");
  if (!handler) throw new Error("create_transaction tool was not registered");
  return handler;
}

describe("create_transaction batch (/transactions/addBatch) success/error attribution", () => {
  it("surfaces errors from the separate `errors` array, not by filtering `transactions`", async () => {
    // Real API shape (confirmed against the live Swagger spec): `transactions` only
    // ever contains successful items (its `success` field is fixed `true` by the
    // schema). Failures live in a separate top-level `errors` array. The old code
    // filtered `transactions` for `success === false`, which always yields [] and
    // silently drops every real error.
    const client = createFakeClient({
      success: false,
      transactions: [{ success: true, message: "Created", id_by_customer: "1" }],
      errors: [
        { success: false, error_code: 12, message: "Invalid currency", request_data: { id_by_customer: "2" } },
      ],
    });
    const handler = getCreateTransactionHandler(client);

    const result = await handler({
      transactions: [
        { account: 1, to_from: "A", amount: 10, booking_date: "2026-01-01 00:00:00" },
        { account: 1, to_from: "B", amount: 20, booking_date: "2026-01-01 00:00:00" },
      ],
    });

    expect(result.content[0].text).toContain("1 succeeded, 1 failed");
    expect(result.content[0].text).toContain("Error 12: Invalid currency");
  });

  it("reports 0 failed when the response genuinely has no errors", async () => {
    const client = createFakeClient({
      success: true,
      transactions: [
        { success: true, message: "Created", id_by_customer: "1" },
        { success: true, message: "Created", id_by_customer: "2" },
      ],
    });
    const handler = getCreateTransactionHandler(client);

    const result = await handler({
      transactions: [
        { account: 1, to_from: "A", amount: 10, booking_date: "2026-01-01 00:00:00" },
        { account: 1, to_from: "B", amount: 20, booking_date: "2026-01-01 00:00:00" },
      ],
    });

    expect(result.content[0].text).toContain("2 succeeded, 0 failed");
  });
});
