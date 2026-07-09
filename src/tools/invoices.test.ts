import { describe, it, expect } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerInvoicesTools, buildInvoiceParams } from "./invoices.js";

// `create_e_invoice`'s zod input schema (including its `.superRefine()` validation)
// is built inline inside `registerInvoicesTools` and isn't exported directly.
// We capture it by registering the tools against a minimal mock server that just
// records whatever `registerTool` config was passed for `create_e_invoice`, then
// exercise the captured schema's `.safeParse()` directly.
function captureEInvoiceInputSchema() {
  let capturedSchema: { safeParse: (data: unknown) => { success: boolean; error?: unknown } } | undefined;

  const mockServer = {
    tool: () => undefined,
    registerTool: (name: string, config: { inputSchema?: unknown }) => {
      if (name === "create_e_invoice") {
        capturedSchema = config.inputSchema as typeof capturedSchema;
      }
    },
  };

  registerInvoicesTools(mockServer as unknown as McpServer, {} as never);

  if (!capturedSchema) {
    throw new Error("create_e_invoice was not registered via registerTool as expected");
  }
  return capturedSchema;
}

// Minimal set of fields required by the create_e_invoice schema, independent of
// item_tax_type/item_tax_amount which each test overrides.
function baseEInvoiceParams(overrides: Record<string, unknown>) {
  return {
    type: "invoice",
    show_prices_type: "net",
    company_name: "Acme GmbH",
    date: "2026-07-09",
    item_name: ["Consulting"],
    item_amount: ["1"],
    item_unit: ["Std."],
    item_vat: ["19"],
    item_single_price: ["100.00"],
    street: "Main St 1",
    zip: "12345",
    city: "Berlin",
    country: "DE",
    email: "billing@example.com",
    e_invoice_id: "0",
    ...overrides,
  };
}

describe("create_e_invoice input schema — item_tax_amount required when item_tax_type is 'S'", () => {
  it("rejects when item_tax_type has 'S' at an index with missing item_tax_amount", () => {
    const schema = captureEInvoiceInputSchema();

    const result = schema.safeParse(
      baseEInvoiceParams({
        item_tax_type: ["S"],
        // item_tax_amount omitted entirely
      })
    );

    expect(result.success).toBe(false);
  });

  it("rejects when item_tax_type has 'S' at an index whose item_tax_amount entry is undefined", () => {
    const schema = captureEInvoiceInputSchema();

    const result = schema.safeParse(
      baseEInvoiceParams({
        item_tax_type: ["Z", "S"],
        item_tax_amount: ["1.00", undefined],
      })
    );

    expect(result.success).toBe(false);
  });

  it("accepts when item_tax_amount is provided at every index where item_tax_type is 'S'", () => {
    const schema = captureEInvoiceInputSchema();

    const result = schema.safeParse(
      baseEInvoiceParams({
        item_tax_type: ["S"],
        item_tax_amount: ["19.00"],
      })
    );

    expect(result.success).toBe(true);
  });

  it("accepts non-'S' tax types with no item_tax_amount at all", () => {
    const schema = captureEInvoiceInputSchema();

    const result = schema.safeParse(
      baseEInvoiceParams({
        item_tax_type: ["Z", "E"],
      })
    );

    expect(result.success).toBe(true);
  });
});

describe("buildInvoiceParams", () => {
  it("drops keys with undefined values", () => {
    const result = buildInvoiceParams({
      company_name: "Acme GmbH",
      customer_number: undefined,
      discount_value: undefined,
    });

    expect(result).toEqual({ company_name: "Acme GmbH" });
    expect(result).not.toHaveProperty("customer_number");
    expect(result).not.toHaveProperty("discount_value");
  });

  it("keeps falsy-but-defined values (0, '', [])", () => {
    const result = buildInvoiceParams({
      due_days: 0,
      correspondence: "",
      item_description: [],
      show_bankdata: false,
      customer_number: undefined,
    });

    expect(result).toEqual({
      due_days: 0,
      correspondence: "",
      item_description: [],
      show_bankdata: false,
    });
    expect(result).not.toHaveProperty("customer_number");
  });
});
