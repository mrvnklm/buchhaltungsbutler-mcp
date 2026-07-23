import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPostingsTools } from "./postings.js";
import type { BbClient } from "../api/client.js";

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

/**
 * Minimal fake McpServer that just captures each registered tool's handler
 * (the last argument passed to `server.tool(...)`) so it can be invoked
 * directly in tests without spinning up a real MCP transport.
 */
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

function getCreatePostingHandler(client: BbClient): ToolHandler {
  const { server, handlers } = createFakeServer();
  registerPostingsTools(server, client);
  const handler = handlers.get("create_posting");
  if (!handler) throw new Error("create_posting tool was not registered");
  return handler;
}

describe("create_posting batch success/error attribution", () => {
  it("receipt batch: attributes failure to the correct NON-trailing item, not the first N by position", async () => {
    // 3-item batch; the API reports an error for the FIRST item (receipt_id_by_customer: 1),
    // while items 2 and 3 actually succeeded. The old positional-slicing bug would have
    // reported items 1 and 2 as "succeeded" (slice(0, 3-1)) and item 3 as failed --
    // exactly backwards from reality.
    const client = createFakeClient({
      success: false,
      errors: [
        {
          success: false,
          error_code: 42,
          message: "Invalid posting account",
          request_data: { receipt_id_by_customer: 1 },
        },
      ],
    });
    const handler = getCreatePostingHandler(client);

    const result = await handler({
      posting_type: "receipt",
      receipts: [1, 2, 3].map((id) => ({
        receipt_id_by_customer: id,
        postingaccounts: ["1000"],
        postingtexts: ["text"],
        vats: ["0_none"],
        amounts: ["10.00"],
      })),
    });

    const text = result.content[0].text;
    expect(text).toContain("2 succeeded, 1 failed");
    // Correctly-succeeded items (2 and 3) must be listed as succeeded.
    expect(text).toMatch(/ID:\s*2/);
    expect(text).toMatch(/ID:\s*3/);
    // The failed item (1) must NOT appear in the succeeded list.
    const succeededSection = text.split("Failed:")[0];
    expect(succeededSection).not.toMatch(/ID:\s*1(\D|$)/);
  });

  it("transaction batch: attributes failure to the correct middle item, not by trailing position", async () => {
    // 3-item batch; the API reports an error for the MIDDLE item (transaction_id_by_customer: 20).
    // The old positional-slicing code would have reported items 10 and 20 as "succeeded"
    // (slice(0, 3-1)) and item 30 as failed -- misattributing both the success and the failure.
    const client = createFakeClient({
      success: false,
      errors: [
        {
          success: false,
          error_code: 7,
          message: "Duplicate transaction",
          request_data: { transaction_id_by_customer: 20 },
        },
      ],
    });
    const handler = getCreatePostingHandler(client);

    const result = await handler({
      posting_type: "transaction",
      transactions: [10, 20, 30].map((id) => ({
        transaction_id_by_customer: id,
        postingaccounts: ["1000"],
        postingtexts: ["text"],
        vats: ["0_none"],
        amounts: ["10.00"],
      })),
    });

    const text = result.content[0].text;
    expect(text).toContain("2 succeeded, 1 failed");
    expect(text).toMatch(/ID:\s*10/);
    expect(text).toMatch(/ID:\s*30/);
    const succeededSection = text.split("Failed:")[0];
    expect(succeededSection).not.toMatch(/ID:\s*20(\D|$)/);
  });

  it("free posting batch: attributes failure to the correct non-trailing item by postingtext", async () => {
    // 3-item batch; the API reports an error for the FIRST item ("posting-A").
    // The old positional-slicing code would have reported "posting-A" and "posting-B"
    // as succeeded (slice(0, 3-1)) and "posting-C" as failed -- again backwards.
    const client = createFakeClient({
      success: false,
      errors: [
        {
          success: false,
          error_code: 3,
          message: "Invalid VAT code",
          request_data: { postingtext: "posting-A" },
        },
      ],
    });
    const handler = getCreatePostingHandler(client);

    const result = await handler({
      posting_type: "free",
      free_postings: ["posting-A", "posting-B", "posting-C"].map((text) => ({
        date: "2026-01-01",
        postingtext: text,
        amount: "10.00",
        postingaccount_debit: 1000,
        postingaccount_credit: 2000,
        vat: "0_none",
      })),
    });

    const text = result.content[0].text;
    expect(text).toContain("2 succeeded, 1 failed");
    expect(text).toMatch(/ID:\s*posting-B/);
    expect(text).toMatch(/ID:\s*posting-C/);
    const succeededSection = text.split("Failed:")[0];
    expect(succeededSection).not.toMatch(/ID:\s*posting-A(\D|$)/);
  });
});

describe("OI postings: null split lines", () => {
  // The earlier version of this change moved the endpoint to a JSON body but
  // left the schema as z.array(z.number().int()), so null was rejected by
  // validation before it ever reached the client -- the feature was inert and
  // a client-level test did not catch it, because it bypassed Zod. This test
  // goes through the registered schema on purpose.
  function schemaFor(toolName: string): z.ZodType {
    const shapes = new Map<string, Record<string, z.ZodType>>();
    const server = {
      tool: (name: string, _desc: string, shape: Record<string, z.ZodType>) => {
        shapes.set(name, shape);
      },
    } as unknown as McpServer;
    registerPostingsTools(server, { request: vi.fn() } as unknown as BbClient);
    const shape = shapes.get(toolName);
    if (!shape) throw new Error(`${toolName} not registered`);
    return z.object(shape);
  }

  it("accepts null elements through the registered tool schema", () => {
    const parsed = schemaFor("create_posting").safeParse({
      posting_type: "transaction",
      transaction_id_by_customer: 5468,
      postingaccounts: ["1200"],
      postingtexts: ["Zahlung"],
      vats: ["19_vat"],
      amounts: ["97.48"],
      oi_receipts_ids_by_customer: [1396, null],
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.oi_receipts_ids_by_customer).toEqual([1396, null]);
    }
  });

  it("accepts null elements in the batch shape too", () => {
    const parsed = schemaFor("create_posting").safeParse({
      posting_type: "transaction",
      transactions: [{
        transaction_id_by_customer: 5468,
        postingaccounts: ["1200"],
        postingtexts: ["Zahlung"],
        vats: ["19_vat"],
        amounts: ["97.48"],
        oi_receipts_ids_by_customer: [null, 1396],
      }],
    });

    expect(parsed.success).toBe(true);
  });

  it("still rejects non-integer, non-null elements", () => {
    const parsed = schemaFor("create_posting").safeParse({
      posting_type: "transaction",
      transaction_id_by_customer: 5468,
      postingaccounts: ["1200"],
      postingtexts: ["Zahlung"],
      vats: ["19_vat"],
      amounts: ["97.48"],
      oi_receipts_ids_by_customer: ["1396"],
    });

    expect(parsed.success).toBe(false);
  });
});
