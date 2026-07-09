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

function getAssignHandler(client: BbClient): ToolHandler {
  const { server, handlers } = createFakeServer();
  registerTransactionsTools(server, client);
  const handler = handlers.get("assign_receipt_to_transaction");
  if (!handler) throw new Error("assign_receipt_to_transaction tool was not registered");
  return handler;
}

describe("assign_receipt_to_transaction assign_batch (/transactions/assign-batch/receipt)", () => {
  it("reports actual per-pair success/failure instead of always claiming full completion", async () => {
    // Previously the handler ignored the response entirely and always reported
    // "Batch assignment completed" for the requested pair count, even when the
    // API reported partial or total failure.
    const client = createFakeClient({
      success: false,
      transactions_to_receipts: [
        { success: true, message: "Assigned", transaction_id_by_customer: "t1", receipt_id_by_customer: "r1" },
      ],
      errors: [
        { success: false, error_code: 12, message: "Receipt already assigned", request_data: { transaction_id_by_customer: "t2", receipt_id_by_customer: "r2" } },
      ],
    });
    const handler = getAssignHandler(client);

    const result = await handler({
      action: "assign_batch",
      transactions_to_receipts: [
        { transaction_id_by_customer: "t1", receipt_id_by_customer: "r1" },
        { transaction_id_by_customer: "t2", receipt_id_by_customer: "r2" },
      ],
    });

    expect(result.content[0].text).toContain("1 succeeded, 1 failed");
    expect(result.content[0].text).toContain("Error 12: Receipt already assigned");
  });

  it("uses the batch rate-limit bucket, not the default general bucket", async () => {
    const client = createFakeClient({
      success: true,
      transactions_to_receipts: [{ success: true, transaction_id_by_customer: "t1", receipt_id_by_customer: "r1" }],
    });
    const handler = getAssignHandler(client);

    await handler({
      action: "assign_batch",
      transactions_to_receipts: [{ transaction_id_by_customer: "t1", receipt_id_by_customer: "r1" }],
    });

    expect(client.request).toHaveBeenCalledWith(
      "/transactions/assign-batch/receipt",
      expect.anything(),
      "batch"
    );
  });
});
