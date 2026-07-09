import { describe, it, expect, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerReceiptsTools } from "./receipts.js";
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

function getCreateReceiptHandler(client: BbClient): ToolHandler {
  const { server, handlers } = createFakeServer();
  registerReceiptsTools(server, client);
  const handler = handlers.get("create_receipt");
  if (!handler) throw new Error("create_receipt tool was not registered");
  return handler;
}

describe("create_receipt batch (/receipts/addBatch) success/error attribution", () => {
  it("surfaces errors from the separate `errors` array, not by filtering `receipts`", async () => {
    // Real API shape (confirmed against the live Swagger spec): `receipts` only ever
    // contains successful items (its `success` field is fixed `true` by the schema).
    // Failures live in a separate top-level `errors` array. The old code filtered
    // `receipts` for `success === false`, which always yields [] and silently drops
    // every real error.
    const client = createFakeClient({
      success: false,
      receipts: [{ success: true, message: "Created", id_by_customer: "1" }],
      errors: [
        { success: false, error_code: 12, message: "Invalid currency", request_data: { id_by_customer: "2" } },
      ],
    });
    const handler = getCreateReceiptHandler(client);

    const result = await handler({
      receipts: [
        { type: "in", counterparty: "A", invoice_number: "1", date: "2026-01-01", amount: 10, currency: "EUR" },
        { type: "in", counterparty: "B", invoice_number: "2", date: "2026-01-01", amount: 20, currency: "EUR" },
      ],
    });

    expect(result.content[0].text).toContain("1 succeeded, 1 failed");
    expect(result.content[0].text).toContain("Error 12: Invalid currency");
  });

  it("reports 0 failed when the response genuinely has no errors", async () => {
    const client = createFakeClient({
      success: true,
      receipts: [
        { success: true, message: "Created", id_by_customer: "1" },
        { success: true, message: "Created", id_by_customer: "2" },
      ],
    });
    const handler = getCreateReceiptHandler(client);

    const result = await handler({
      receipts: [
        { type: "in", counterparty: "A", invoice_number: "1", date: "2026-01-01", amount: 10, currency: "EUR" },
        { type: "in", counterparty: "B", invoice_number: "2", date: "2026-01-01", amount: 20, currency: "EUR" },
      ],
    });

    expect(result.content[0].text).toContain("2 succeeded, 0 failed");
  });
});
