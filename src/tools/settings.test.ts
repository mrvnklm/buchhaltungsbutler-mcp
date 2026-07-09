import { describe, it, expect } from "vitest";
import { z } from "zod";
import { buildDebtorParams, buildCreditorParams } from "./settings.js";

// These schemas mirror the debtor/creditor fields accepted by the `add`/`update`
// actions of `manage_debtors` / `manage_creditors` in settings.ts. They exist so the
// drift-check tests below can detect when a new field is added to the tool's zod
// input schema without also being added to the allowlist array used inside
// buildDebtorParams/buildCreditorParams — otherwise that field would be silently
// dropped from every request with nothing catching it.
const debtorAddSchema = z.object({
  name: z.string().optional(),
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
});

const creditorAddSchema = z.object({
  name: z.string().optional(),
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
});

// Fields that are intentionally not passed through buildDebtorParams/buildCreditorParams
// because they are handled separately by the caller (e.g. postingaccount_number is
// attached directly for 'update', and is server-generated on 'add').
const debtorPassthroughExclusions = new Set(["postingaccount_number"]);
const creditorPassthroughExclusions = new Set(["postingaccount_number"]);

describe("buildDebtorParams / buildCreditorParams drift checks", () => {
  it("debtor allowlist contains every schema field (minus intentional exclusions)", () => {
    const schemaKeys = Object.keys(debtorAddSchema.shape).filter(
      (key) => !debtorPassthroughExclusions.has(key)
    );

    const sample: Record<string, unknown> = {};
    for (const key of schemaKeys) sample[key] = `value-${key}`;

    const result = buildDebtorParams(sample);
    const allowlistedKeys = Object.keys(result);

    for (const key of schemaKeys) {
      expect(allowlistedKeys).toContain(key);
    }
  });

  it("creditor allowlist contains every schema field (minus intentional exclusions)", () => {
    const schemaKeys = Object.keys(creditorAddSchema.shape).filter(
      (key) => !creditorPassthroughExclusions.has(key)
    );

    const sample: Record<string, unknown> = {};
    for (const key of schemaKeys) sample[key] = `value-${key}`;

    const result = buildCreditorParams(sample);
    const allowlistedKeys = Object.keys(result);

    for (const key of schemaKeys) {
      expect(allowlistedKeys).toContain(key);
    }
  });
});

describe("buildDebtorParams", () => {
  it("only includes allowlisted keys and drops undefined values", () => {
    const result = buildDebtorParams({
      name: "Acme GmbH",
      contact_person_name: "Jane Doe",
      street: "Main St 1",
      additional_address_line: undefined,
      customer_number: "C-001",
      zip: "12345",
      city: "Berlin",
      country: "DE",
      sales_tax_id: undefined,
      email: "jane@example.com",
      iban: "DE00123456789",
      bic: "DEUTDEBBXXX",
      // Not in the allowlist / not part of a single debtor's fields — should be dropped.
      action: "add",
      limit: 10,
      offset: 0,
      debtors: [{ name: "other" }],
      not_a_real_field: "should not appear",
    });

    expect(result).toEqual({
      name: "Acme GmbH",
      contact_person_name: "Jane Doe",
      street: "Main St 1",
      customer_number: "C-001",
      zip: "12345",
      city: "Berlin",
      country: "DE",
      email: "jane@example.com",
      iban: "DE00123456789",
      bic: "DEUTDEBBXXX",
    });
    expect(result).not.toHaveProperty("additional_address_line");
    expect(result).not.toHaveProperty("sales_tax_id");
    expect(result).not.toHaveProperty("action");
    expect(result).not.toHaveProperty("limit");
    expect(result).not.toHaveProperty("offset");
    expect(result).not.toHaveProperty("debtors");
    expect(result).not.toHaveProperty("not_a_real_field");
  });
});

describe("buildCreditorParams", () => {
  it("only includes allowlisted keys and drops undefined values", () => {
    const result = buildCreditorParams({
      name: "Beispiel AG",
      contact_person_name: "John Smith",
      street: undefined,
      additional_address_line: "Suite 5",
      zip: "54321",
      city: "Hamburg",
      country: "DE",
      sales_tax_id: "DE123456789",
      email: undefined,
      iban: "DE99987654321",
      bic: "COBADEFFXXX",
      due_in_days: 30,
      // Not in the allowlist / not part of a single creditor's fields — should be dropped.
      action: "update",
      postingaccount_number: "70000",
      creditors: [{ name: "other" }],
      not_a_real_field: "should not appear",
    });

    expect(result).toEqual({
      name: "Beispiel AG",
      contact_person_name: "John Smith",
      additional_address_line: "Suite 5",
      zip: "54321",
      city: "Hamburg",
      country: "DE",
      sales_tax_id: "DE123456789",
      iban: "DE99987654321",
      bic: "COBADEFFXXX",
      due_in_days: 30,
    });
    expect(result).not.toHaveProperty("street");
    expect(result).not.toHaveProperty("email");
    expect(result).not.toHaveProperty("action");
    expect(result).not.toHaveProperty("postingaccount_number");
    expect(result).not.toHaveProperty("creditors");
    expect(result).not.toHaveProperty("not_a_real_field");
  });
});
