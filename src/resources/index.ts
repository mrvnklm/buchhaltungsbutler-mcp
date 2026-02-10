import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BbClient } from "../api/client.js";
import type { ApiResponse } from "../types/common.js";
import { formatList, formatSingle } from "../utils/formatters.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

export function registerResources(server: McpServer, client: BbClient): void {
  // Static resource: Accounts
  server.resource("accounts", "bb://accounts", async (uri) => {
    const res = await client.request<ApiResponse<AnyRecord[]>>("/accounts/get");
    const text = formatList("Accounts", res.data ?? []);
    return { contents: [{ uri: "bb://accounts", text, mimeType: "text/plain" }] };
  });

  // Static resource: Posting Accounts
  server.resource("posting-accounts", "bb://posting-accounts", async (uri) => {
    const res = await client.request<ApiResponse<AnyRecord[]>>("/settings/get/postingaccounts");
    const text = formatList("Posting Accounts", res.data ?? []);
    return { contents: [{ uri: "bb://posting-accounts", text, mimeType: "text/plain" }] };
  });

  // Static resource: Cost Locations
  server.resource("cost-locations", "bb://cost-locations", async (uri) => {
    const res = await client.request<ApiResponse<AnyRecord[]>>("/cost-locations/get");
    const text = formatList("Cost Locations", res.data ?? []);
    return { contents: [{ uri: "bb://cost-locations", text, mimeType: "text/plain" }] };
  });

  // Dynamic resource: Creditor by ID
  const creditorTemplate = new ResourceTemplate("bb://creditors/{id}", { list: undefined });
  server.resource("creditor", creditorTemplate, async (uri, { id }) => {
    const res = await client.request<ApiResponse<AnyRecord[]>>("/settings/get/creditors");
    const items = res.data ?? [];
    const found = items.find((item) => String(item.postingaccount_number) === String(id));
    const text = found ? formatSingle("Creditor", found) : "Creditor not found";
    return { contents: [{ uri: `bb://creditors/${id}`, text, mimeType: "text/plain" }] };
  });

  // Dynamic resource: Debtor by ID
  const debtorTemplate = new ResourceTemplate("bb://debtors/{id}", { list: undefined });
  server.resource("debtor", debtorTemplate, async (uri, { id }) => {
    const res = await client.request<ApiResponse<AnyRecord[]>>("/settings/get/debtors");
    const items = res.data ?? [];
    const found = items.find((item) => String(item.postingaccount_number) === String(id));
    const text = found ? formatSingle("Debtor", found) : "Debtor not found";
    return { contents: [{ uri: `bb://debtors/${id}`, text, mimeType: "text/plain" }] };
  });
}
