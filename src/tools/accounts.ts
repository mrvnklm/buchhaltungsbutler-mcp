import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BbClient } from "../api/client.js";
import { ApiError } from "../api/errors.js";
import type { ApiResponse } from "../types/common.js";
import type { AccountItem } from "../types/api-responses.js";
import { formatList, formatSuccess } from "../utils/formatters.js";
import { accountTypeSchema } from "../utils/validators.js";

export function registerAccountsTools(server: McpServer, client: BbClient): void {
  server.tool(
    "list_accounts",
    "List all payment/bank accounts (Zahlungskonten)",
    {},
    async () => {
      try {
        const res = await client.request<ApiResponse<AccountItem[]>>("/accounts/get");
        return {
          content: [{
            type: "text" as const,
            text: formatList("Accounts", res.data ?? [], res.rows),
          }],
        };
      } catch (error) {
        if (error instanceof ApiError) {
          return {
            content: [{ type: "text" as const, text: error.toText() }],
            isError: true,
          };
        }
        throw error;
      }
    }
  );

  server.tool(
    "create_account",
    "Create a new payment/bank account (Zahlungskonto)",
    {
      type: accountTypeSchema.describe("Account type"),
      name: z.string().describe("Account name"),
      postingaccount_number: z.number().int().describe("Posting account number"),
      receipt_creates_transaction: z.boolean().optional().describe("Whether uploaded receipts automatically create transactions"),
      is_revision_safe: z.boolean().optional().describe("Whether the account is revision-safe (cash accounts only)"),
    },
    async (params) => {
      try {
        const requestParams: Record<string, unknown> = {
          type: params.type,
          name: params.name,
          postingaccount_number: params.postingaccount_number,
        };
        if (params.receipt_creates_transaction !== undefined) {
          requestParams.receipt_creates_transaction = params.receipt_creates_transaction;
        }
        if (params.is_revision_safe !== undefined) {
          requestParams.is_revision_safe = params.is_revision_safe;
        }

        const res = await client.request<ApiResponse & { postingaccount_number?: number }>("/accounts/add", requestParams);
        return {
          content: [{
            type: "text" as const,
            text: formatSuccess("Account created", {
              postingaccount_number: res.postingaccount_number ?? params.postingaccount_number,
              name: params.name,
              type: params.type,
            }),
          }],
        };
      } catch (error) {
        if (error instanceof ApiError) {
          return {
            content: [{ type: "text" as const, text: error.toText() }],
            isError: true,
          };
        }
        throw error;
      }
    }
  );
}
