import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BbClient } from "../api/client.js";
import { ApiError } from "../api/errors.js";
import type { ApiResponse } from "../types/common.js";
import { formatSuccess } from "../utils/formatters.js";
import { dateSchema, invoiceTypeSchema, showPricesTypeSchema, eInvoiceTaxTypeSchema } from "../utils/validators.js";

const baseInvoiceShape = {
  type: invoiceTypeSchema.describe("Invoice type: 'invoice', 'credit', or 'offer'"),
  show_prices_type: showPricesTypeSchema.describe("Price display type: 'net' or 'gross'"),
  company_name: z.string().describe("Company/customer name"),
  date: dateSchema.describe("Invoice date (YYYY-MM-DD)"),

  // Line items (parallel arrays)
  item_name: z.array(z.string()).describe("Item names"),
  item_amount: z.array(z.string()).describe("Item quantities"),
  item_unit: z.array(z.string()).describe("Item units (e.g. 'Std.', 'Stk.')"),
  item_vat: z.array(z.string()).describe("Item VAT percentages (0-100)"),
  item_single_price: z.array(z.string()).describe("Item unit prices"),

  // Optional address fields
  contact_person_name: z.string().optional().describe("Contact person name"),
  street: z.string().optional().describe("Street address"),
  additional_addressline: z.string().optional().describe("Additional address line"),
  zip: z.string().optional().describe("ZIP/postal code"),
  city: z.string().optional().describe("City"),
  country: z.string().optional().describe("Country"),
  email: z.string().optional().describe("Email address"),

  // Optional recurring
  recurring_interval: z.enum(["weekly", "monthly", "quarterly", "yearly"]).optional().describe("Recurring invoice interval"),
  recurring_date_next: dateSchema.optional().describe("Next recurring date (YYYY-MM-DD)"),

  // Optional metadata
  date_of_supply: z.string().optional().describe("Date/period of supply"),
  correspondence: z.string().optional().describe("Correspondence text"),
  discount_type: z.enum(["percent", "EUR"]).optional().describe("Discount type"),
  discount_value: z.string().optional().describe("Discount value"),
  payment_conditions: z.string().optional().describe("Payment conditions text"),
  due_days: z.number().int().optional().describe("Payment due in days"),
  final_provisions: z.string().optional().describe("Final provisions text"),
  show_bankdata: z.boolean().optional().describe("Show bank data on invoice"),
  show_contactdata: z.boolean().optional().describe("Show contact data on invoice"),
  item_description: z.array(z.string()).optional().describe("Item descriptions (per line item)"),
  customer_number: z.string().optional().describe("Customer number"),
} as const;

export function buildInvoiceParams(params: Record<string, unknown>): Record<string, unknown> {
  const requestParams: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      requestParams[key] = value;
    }
  }
  return requestParams;
}

export function registerInvoicesTools(server: McpServer, client: BbClient): void {
  server.tool(
    "create_invoice",
    "Create and finalize an invoice, credit note, or offer (Rechnung/Gutschrift/Angebot erstellen). Returns the invoice number and PDF file name.",
    {
      ...baseInvoiceShape,
      invoicenumber: z.string().optional().describe("Custom invoice number (auto-generated if omitted)"),
      payment_reference: z.string().optional().describe("Payment reference"),
    },
    async (params) => {
      try {
        const res = await client.request<ApiResponse & { id_by_customer?: number; invoicenumber?: string; file_name?: string }>(
          "/invoices/create",
          buildInvoiceParams(params)
        );
        return {
          content: [{
            type: "text" as const,
            text: formatSuccess(res.message ?? "Invoice created", {
              id_by_customer: res.id_by_customer,
              invoicenumber: res.invoicenumber,
              file_name: res.file_name,
              type: params.type,
              company_name: params.company_name,
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

  const eInvoiceShape = {
    ...baseInvoiceShape,
    // Override address fields to required for e-invoice
    street: z.string().describe("Street address (required for e-invoice)"),
    zip: z.string().describe("ZIP/postal code (required for e-invoice)"),
    city: z.string().describe("City (required for e-invoice)"),
    country: z.string().describe("Country (required for e-invoice)"),
    email: z.string().describe("Email address (required for e-invoice)"),

    // E-invoice specific fields
    e_invoice_id: z.string().describe("Buyer reference / Leitweg-ID (use '0' as default)"),
    item_tax_type: z.array(eInvoiceTaxTypeSchema).describe("Tax type per line item: S, Z, AE, K, G, or E"),
    item_tax_amount: z.array(z.string()).optional().describe("Tax amount per line item (required when tax_type is 'S')"),

    invoicenumber: z.string().optional().describe("Custom invoice number (auto-generated if omitted)"),
    payment_reference: z.string().optional().describe("Payment reference"),
  } as const;

  const eInvoiceInputSchema = z.object(eInvoiceShape).check((payload) => {
    payload.value.item_tax_type.forEach((taxType, index) => {
      if (taxType === "S" && payload.value.item_tax_amount?.[index] === undefined) {
        payload.issues.push({
          code: "custom",
          message: `item_tax_amount is required at the same index where item_tax_type is "S"`,
          path: ["item_tax_amount", index],
          input: payload.value.item_tax_amount?.[index],
        });
      }
    });
  });

  server.registerTool(
    "create_e_invoice",
    {
      description: `Create an e-invoice (XRechnung/ZUGFeRD) with structured tax data. Requires address fields (street, zip, city, country, email) and tax type per line item.

Tax types: S (Standard rate), Z (Zero rated), AE (VAT Reverse Charge), K (Intra-community supply), G (Export outside EU), E (Exempt from tax).
item_tax_amount is required when item_tax_type is "S".`,
      inputSchema: eInvoiceInputSchema,
    },
    async (params) => {
      try {
        const res = await client.request<ApiResponse & { id_by_customer?: number; invoicenumber?: string; file_name?: string }>(
          "/invoices/create/e-invoice",
          buildInvoiceParams(params)
        );
        return {
          content: [{
            type: "text" as const,
            text: formatSuccess(res.message ?? "E-invoice created", {
              id_by_customer: res.id_by_customer,
              invoicenumber: res.invoicenumber,
              file_name: res.file_name,
              type: params.type,
              company_name: params.company_name,
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

  server.tool(
    "create_invoice_draft",
    "Create an invoice draft (Rechnungsentwurf). Draft invoices can be edited before finalizing. No invoice number is assigned yet.",
    {
      ...baseInvoiceShape,
    },
    async (params) => {
      try {
        const res = await client.request<ApiResponse>(
          "/invoices/create/draft",
          buildInvoiceParams(params)
        );
        return {
          content: [{
            type: "text" as const,
            text: formatSuccess(res.message ?? "Invoice draft created", {
              type: params.type,
              company_name: params.company_name,
              date: params.date,
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
