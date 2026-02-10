import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BbClient } from "../api/client.js";
import { ApiError } from "../api/errors.js";
import type { ApiResponse, BatchResponse } from "../types/common.js";
import type { DebtorCreditorItem, PostingAccountItem } from "../types/api-responses.js";
import { formatList, formatSuccess, formatBatchResult } from "../utils/formatters.js";

export function registerSettingsTools(server: McpServer, client: BbClient): void {
  // ── manage_debtors ──────────────────────────────────────────────
  server.tool(
    "manage_debtors",
    "Manage debtor accounts (Debitoren) - list, add, add_batch, or update",
    {
      action: z.enum(["list", "add", "add_batch", "update"]).describe("Operation to perform"),
      limit: z.number().int().min(1).optional().describe("Max results (list only)"),
      offset: z.number().int().min(0).optional().describe("Pagination offset (list only)"),
      name: z.string().optional().describe("Debtor name (required for add/update)"),
      postingaccount_number: z.string().optional().describe("Posting account number (required for update)"),
      contact_person_name: z.string().optional().describe("Contact person name"),
      street: z.string().optional().describe("Street address"),
      additional_address_line: z.string().optional().describe("Additional address line"),
      customer_number: z.string().optional().describe("Customer number"),
      zip: z.string().optional().describe("ZIP/postal code"),
      city: z.string().optional().describe("City"),
      country: z.string().optional().describe("Country"),
      sales_tax_id: z.string().optional().describe("Sales tax ID"),
      email: z.string().optional().describe("Email address"),
      iban: z.string().optional().describe("IBAN"),
      bic: z.string().optional().describe("BIC"),
      debtors: z.array(z.object({
        name: z.string().describe("Debtor name"),
        postingaccount_number: z.string().optional(),
        contact_person_name: z.string().optional(),
        street: z.string().optional(),
        additional_address_line: z.string().optional(),
        customer_number: z.string().optional(),
        zip: z.string().optional(),
        city: z.string().optional(),
        country: z.string().optional(),
        sales_tax_id: z.string().optional(),
        email: z.string().optional(),
        iban: z.string().optional(),
        bic: z.string().optional(),
      })).optional().describe("Array of debtors (add_batch only)"),
    },
    async (params) => {
      try {
        switch (params.action) {
          case "list": {
            const requestParams: Record<string, unknown> = {};
            if (params.limit !== undefined) requestParams.limit = params.limit;
            if (params.offset !== undefined) requestParams.offset = params.offset;

            const res = await client.request<ApiResponse<DebtorCreditorItem[]>>(
              "/settings/get/debtors",
              requestParams
            );
            return {
              content: [{
                type: "text" as const,
                text: formatList("Debtors", res.data ?? [], res.rows),
              }],
            };
          }
          case "add": {
            if (!params.name) {
              return {
                content: [{ type: "text" as const, text: "Error: name is required for add action" }],
                isError: true,
              };
            }
            const requestParams = buildDebtorParams(params);
            const res = await client.request<ApiResponse & { postingaccount_number?: string }>(
              "/settings/add/debtor",
              requestParams
            );
            return {
              content: [{
                type: "text" as const,
                text: formatSuccess(res.message ?? "Debtor added", {
                  name: params.name,
                  postingaccount_number: res.postingaccount_number,
                }),
              }],
            };
          }
          case "add_batch": {
            if (!params.debtors || params.debtors.length === 0) {
              return {
                content: [{ type: "text" as const, text: "Error: debtors array is required for add_batch action" }],
                isError: true,
              };
            }
            const res = await client.request<BatchResponse>(
              "/settings/add-batch/debtors",
              { debtors: params.debtors },
              "batch"
            );
            const successes = (res.debtors ?? []) as unknown[];
            const errors = res.errors ?? [];
            return {
              content: [{
                type: "text" as const,
                text: formatBatchResult("Batch Add Debtors", successes, errors),
              }],
            };
          }
          case "update": {
            if (!params.postingaccount_number) {
              return {
                content: [{ type: "text" as const, text: "Error: postingaccount_number is required for update action" }],
                isError: true,
              };
            }
            const requestParams = buildDebtorParams(params);
            requestParams.postingaccount_number = params.postingaccount_number;
            const res = await client.request<ApiResponse>(
              "/settings/update/debtor",
              requestParams
            );
            return {
              content: [{
                type: "text" as const,
                text: formatSuccess(res.message ?? "Debtor updated", {
                  postingaccount_number: params.postingaccount_number,
                  name: params.name,
                }),
              }],
            };
          }
        }
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

  // ── manage_creditors ────────────────────────────────────────────
  server.tool(
    "manage_creditors",
    "Manage creditor accounts (Kreditoren) - list, add, add_batch, or update",
    {
      action: z.enum(["list", "add", "add_batch", "update"]).describe("Operation to perform"),
      limit: z.number().int().min(1).optional().describe("Max results (list only)"),
      offset: z.number().int().min(0).optional().describe("Pagination offset (list only)"),
      name: z.string().optional().describe("Creditor name (required for add/update)"),
      postingaccount_number: z.string().optional().describe("Posting account number (required for update)"),
      contact_person_name: z.string().optional().describe("Contact person name"),
      street: z.string().optional().describe("Street address"),
      additional_address_line: z.string().optional().describe("Additional address line"),
      zip: z.string().optional().describe("ZIP/postal code"),
      city: z.string().optional().describe("City"),
      country: z.string().optional().describe("Country"),
      sales_tax_id: z.string().optional().describe("Sales tax ID"),
      email: z.string().optional().describe("Email address"),
      iban: z.string().optional().describe("IBAN"),
      bic: z.string().optional().describe("BIC"),
      due_in_days: z.number().int().optional().describe("Default payment due in days"),
      creditors: z.array(z.object({
        name: z.string().describe("Creditor name"),
        postingaccount_number: z.string().optional(),
        contact_person_name: z.string().optional(),
        street: z.string().optional(),
        additional_address_line: z.string().optional(),
        zip: z.string().optional(),
        city: z.string().optional(),
        country: z.string().optional(),
        sales_tax_id: z.string().optional(),
        email: z.string().optional(),
        iban: z.string().optional(),
        bic: z.string().optional(),
        due_in_days: z.number().int().optional(),
      })).optional().describe("Array of creditors (add_batch only)"),
    },
    async (params) => {
      try {
        switch (params.action) {
          case "list": {
            const requestParams: Record<string, unknown> = {};
            if (params.limit !== undefined) requestParams.limit = params.limit;
            if (params.offset !== undefined) requestParams.offset = params.offset;

            const res = await client.request<ApiResponse<DebtorCreditorItem[]>>(
              "/settings/get/creditors",
              requestParams
            );
            return {
              content: [{
                type: "text" as const,
                text: formatList("Creditors", res.data ?? [], res.rows),
              }],
            };
          }
          case "add": {
            if (!params.name) {
              return {
                content: [{ type: "text" as const, text: "Error: name is required for add action" }],
                isError: true,
              };
            }
            const requestParams = buildCreditorParams(params);
            const res = await client.request<ApiResponse & { postingaccount_number?: string }>(
              "/settings/add/creditor",
              requestParams
            );
            return {
              content: [{
                type: "text" as const,
                text: formatSuccess(res.message ?? "Creditor added", {
                  name: params.name,
                  postingaccount_number: res.postingaccount_number,
                }),
              }],
            };
          }
          case "add_batch": {
            if (!params.creditors || params.creditors.length === 0) {
              return {
                content: [{ type: "text" as const, text: "Error: creditors array is required for add_batch action" }],
                isError: true,
              };
            }
            const res = await client.request<BatchResponse>(
              "/settings/add-batch/creditors",
              { creditors: params.creditors },
              "batch"
            );
            const successes = (res.creditors ?? []) as unknown[];
            const errors = res.errors ?? [];
            return {
              content: [{
                type: "text" as const,
                text: formatBatchResult("Batch Add Creditors", successes, errors),
              }],
            };
          }
          case "update": {
            if (!params.postingaccount_number) {
              return {
                content: [{ type: "text" as const, text: "Error: postingaccount_number is required for update action" }],
                isError: true,
              };
            }
            const requestParams = buildCreditorParams(params);
            requestParams.postingaccount_number = params.postingaccount_number;
            const res = await client.request<ApiResponse>(
              "/settings/update/creditor",
              requestParams
            );
            return {
              content: [{
                type: "text" as const,
                text: formatSuccess(res.message ?? "Creditor updated", {
                  postingaccount_number: params.postingaccount_number,
                  name: params.name,
                }),
              }],
            };
          }
        }
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

  // ── manage_posting_accounts ─────────────────────────────────────
  server.tool(
    "manage_posting_accounts",
    "Manage posting accounts (Buchungskonten) - list, add, or update",
    {
      action: z.enum(["list", "add", "update"]).describe("Operation to perform"),
      order: z.string().optional().describe("Sort order, e.g. 'postingaccount_number ASC' (list only)"),
      exclude_postingaccounts: z.boolean().optional().describe("Exclude posting accounts from results (list only)"),
      exclude_accounts: z.boolean().optional().describe("Exclude payment accounts from results (list only)"),
      exclude_creditors: z.boolean().optional().describe("Exclude creditor accounts from results (list only)"),
      exclude_debtors: z.boolean().optional().describe("Exclude debtor accounts from results (list only)"),
      name: z.string().optional().describe("Account name (required for add, optional for update)"),
      postingaccount_number: z.number().int().optional().describe("Posting account number (required for add/update)"),
      parent_postingaccount_number: z.number().int().optional().describe("Parent posting account number (required for add)"),
    },
    async (params) => {
      try {
        switch (params.action) {
          case "list": {
            const requestParams: Record<string, unknown> = {};
            if (params.order !== undefined) requestParams.order = params.order;
            if (params.exclude_postingaccounts !== undefined) requestParams.exclude_postingaccounts = params.exclude_postingaccounts;
            if (params.exclude_accounts !== undefined) requestParams.exclude_accounts = params.exclude_accounts;
            if (params.exclude_creditors !== undefined) requestParams.exclude_creditors = params.exclude_creditors;
            if (params.exclude_debtors !== undefined) requestParams.exclude_debtors = params.exclude_debtors;

            const res = await client.request<ApiResponse<PostingAccountItem[]>>(
              "/settings/get/postingaccounts",
              requestParams
            );
            return {
              content: [{
                type: "text" as const,
                text: formatList("Posting Accounts", res.data ?? [], res.rows),
              }],
            };
          }
          case "add": {
            if (!params.name) {
              return {
                content: [{ type: "text" as const, text: "Error: name is required for add action" }],
                isError: true,
              };
            }
            if (params.postingaccount_number === undefined) {
              return {
                content: [{ type: "text" as const, text: "Error: postingaccount_number is required for add action" }],
                isError: true,
              };
            }
            if (params.parent_postingaccount_number === undefined) {
              return {
                content: [{ type: "text" as const, text: "Error: parent_postingaccount_number is required for add action" }],
                isError: true,
              };
            }
            const res = await client.request<ApiResponse>(
              "/settings/add/postingaccount",
              {
                name: params.name,
                postingaccount_number: params.postingaccount_number,
                parent_postingaccount_number: params.parent_postingaccount_number,
              }
            );
            return {
              content: [{
                type: "text" as const,
                text: formatSuccess(res.message ?? "Posting account added", {
                  name: params.name,
                  postingaccount_number: params.postingaccount_number,
                  parent_postingaccount_number: params.parent_postingaccount_number,
                }),
              }],
            };
          }
          case "update": {
            if (params.postingaccount_number === undefined) {
              return {
                content: [{ type: "text" as const, text: "Error: postingaccount_number is required for update action" }],
                isError: true,
              };
            }
            const requestParams: Record<string, unknown> = {
              postingaccount_number: params.postingaccount_number,
            };
            if (params.name !== undefined) requestParams.name = params.name;

            const res = await client.request<ApiResponse>(
              "/settings/update/postingaccount",
              requestParams
            );
            return {
              content: [{
                type: "text" as const,
                text: formatSuccess(res.message ?? "Posting account updated", {
                  postingaccount_number: params.postingaccount_number,
                  name: params.name,
                }),
              }],
            };
          }
        }
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

// ── Helpers ─────────────────────────────────────────────────────

function buildDebtorParams(params: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const fields = [
    "name", "contact_person_name", "street", "additional_address_line",
    "customer_number", "zip", "city", "country", "sales_tax_id",
    "email", "iban", "bic",
  ];
  for (const field of fields) {
    if (params[field] !== undefined) result[field] = params[field];
  }
  return result;
}

function buildCreditorParams(params: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const fields = [
    "name", "contact_person_name", "street", "additional_address_line",
    "zip", "city", "country", "sales_tax_id",
    "email", "iban", "bic", "due_in_days",
  ];
  for (const field of fields) {
    if (params[field] !== undefined) result[field] = params[field];
  }
  return result;
}
