import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BbClient } from "./api/client.js";
import type { BbConfig } from "./types/common.js";
import { registerResources } from "./resources/index.js";
import { registerAccountsTools } from "./tools/accounts.js";
import { registerCommentsTools } from "./tools/comments.js";
import { registerCostLocationsTools } from "./tools/cost-locations.js";
import { registerSettingsTools } from "./tools/settings.js";
import { registerReceiptsTools } from "./tools/receipts.js";
import { registerTransactionsTools } from "./tools/transactions.js";
import { registerPostingsTools } from "./tools/postings.js";
import { registerInvoicesTools } from "./tools/invoices.js";

// package.json sits one directory above dist/ (repo root, npm package root,
// and the .mcpb bundle root all share this layout) -- read it directly
// instead of hardcoding a version that drifts out of sync.
const packageDir = dirname(fileURLToPath(import.meta.url));
const { version: packageVersion } = JSON.parse(
  readFileSync(join(packageDir, "..", "package.json"), "utf8")
) as { version: string };

export function createServer(config: BbConfig): McpServer {
  const server = new McpServer({
    name: "buchhaltungsbutler",
    version: packageVersion,
  });

  const client = new BbClient(config);

  registerResources(server, client);

  registerAccountsTools(server, client);
  registerCommentsTools(server, client);
  registerCostLocationsTools(server, client);
  registerSettingsTools(server, client);
  registerReceiptsTools(server, client);
  registerTransactionsTools(server, client);
  registerPostingsTools(server, client);
  registerInvoicesTools(server, client);

  return server;
}
