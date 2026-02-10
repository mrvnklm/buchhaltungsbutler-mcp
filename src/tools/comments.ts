import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BbClient } from "../api/client.js";
import { ApiError } from "../api/errors.js";
import type { ApiResponse } from "../types/common.js";
import { formatSuccess } from "../utils/formatters.js";

export function registerCommentsTools(server: McpServer, client: BbClient): void {
  server.tool(
    "add_comment",
    "Add a comment to a transaction or receipt. Provide exactly one of transaction_id_by_customer or receipt_id_by_customer.",
    {
      comment_text: z.string().min(2).max(210).describe("Comment text (2-210 characters)"),
      transaction_id_by_customer: z.number().int().optional().describe("Transaction ID to comment on"),
      receipt_id_by_customer: z.number().int().optional().describe("Receipt ID to comment on"),
    },
    async (params) => {
      try {
        const hasTx = params.transaction_id_by_customer !== undefined;
        const hasRx = params.receipt_id_by_customer !== undefined;
        if (hasTx === hasRx) {
          return {
            content: [{ type: "text" as const, text: "Error: Provide exactly one of transaction_id_by_customer or receipt_id_by_customer" }],
            isError: true,
          };
        }

        const requestParams: Record<string, unknown> = {
          comment_text: params.comment_text,
        };
        if (hasTx) requestParams.transaction_id_by_customer = params.transaction_id_by_customer;
        if (hasRx) requestParams.receipt_id_by_customer = params.receipt_id_by_customer;

        const res = await client.request<ApiResponse>("/comments/add", requestParams);
        return {
          content: [{
            type: "text" as const,
            text: formatSuccess(res.message || "Comment added", {
              comment_text: params.comment_text,
              transaction_id_by_customer: params.transaction_id_by_customer,
              receipt_id_by_customer: params.receipt_id_by_customer,
            }),
          }],
        };
      } catch (error) {
        if (error instanceof ApiError) {
          return { content: [{ type: "text" as const, text: error.toText() }], isError: true };
        }
        throw error;
      }
    }
  );
}
