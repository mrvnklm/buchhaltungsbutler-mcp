import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BbClient } from "../api/client.js";
import { ApiError } from "../api/errors.js";
import type { ApiResponse } from "../types/common.js";
import type { CostLocationItem } from "../types/api-responses.js";
import { formatList, formatSuccess } from "../utils/formatters.js";

export function registerCostLocationsTools(server: McpServer, client: BbClient): void {
  server.tool(
    "list_cost_locations",
    "List cost locations (Kostenstellen)",
    {
      code: z.string().optional().describe("Filter by specific cost location code"),
      limit: z.number().int().min(1).max(1000).optional().describe("Maximum number of results (max 1000)"),
      offset: z.number().int().min(0).optional().describe("Offset for pagination"),
    },
    async (params) => {
      try {
        const requestParams: Record<string, unknown> = {};
        if (params.code !== undefined) requestParams.code = params.code;
        if (params.limit !== undefined) requestParams.limit = params.limit;
        if (params.offset !== undefined) requestParams.offset = params.offset;

        const res = await client.request<ApiResponse<CostLocationItem[]>>(
          "/cost-locations/get",
          requestParams
        );
        return {
          content: [{
            type: "text" as const,
            text: formatList("Cost Locations", res.data ?? [], res.rows),
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
    "manage_cost_location",
    "Add, update, or delete a cost location (Kostenstelle)",
    {
      action: z.enum(["add", "update", "delete"]).describe("Operation to perform"),
      code: z.string().max(10).regex(/^[a-zA-Z0-9]+$/, "Code must be alphanumeric").describe("Cost location code (max 10 alphanumeric characters)"),
      name: z.string().optional().describe("Cost location name (required for add/update)"),
    },
    async (params) => {
      try {
        switch (params.action) {
          case "add": {
            if (!params.name) {
              return {
                content: [{ type: "text" as const, text: "Error: name is required for add action" }],
                isError: true,
              };
            }
            const res = await client.request<ApiResponse>("/cost-locations/add", {
              code: params.code,
              name: params.name,
            });
            return {
              content: [{
                type: "text" as const,
                text: formatSuccess(res.message ?? "Cost location added", {
                  code: params.code,
                  name: params.name,
                }),
              }],
            };
          }
          case "update": {
            if (!params.name) {
              return {
                content: [{ type: "text" as const, text: "Error: name is required for update action" }],
                isError: true,
              };
            }
            const res = await client.request<ApiResponse>("/cost-locations/update", {
              code: params.code,
              name: params.name,
            });
            return {
              content: [{
                type: "text" as const,
                text: formatSuccess(res.message ?? "Cost location updated", {
                  code: params.code,
                  name: params.name,
                }),
              }],
            };
          }
          case "delete": {
            const res = await client.request<ApiResponse>("/cost-locations/delete", {
              code: params.code,
            });
            return {
              content: [{
                type: "text" as const,
                text: formatSuccess(res.message ?? "Cost location deleted", {
                  code: params.code,
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
