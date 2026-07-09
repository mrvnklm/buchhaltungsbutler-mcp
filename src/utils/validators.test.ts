import { describe, it, expect } from "vitest";
import {
  dateSchema,
  dateTimeSchema,
  currencySchema,
  receiptTypeSchema,
  vatCodeSchema,
  eInvoiceTaxTypeSchema,
  listDirectionSchema,
  invoiceTypeSchema,
  accountTypeSchema,
  showPricesTypeSchema,
} from "./validators.js";

describe("dateSchema", () => {
  it("accepts a well-formed date", () => {
    expect(dateSchema.safeParse("2024-01-01").success).toBe(true);
  });

  it("rejects a date with single-digit month/day", () => {
    expect(dateSchema.safeParse("2024-1-1").success).toBe(false);
  });

  it("rejects a date using slashes", () => {
    expect(dateSchema.safeParse("2024/01/01").success).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(dateSchema.safeParse(20240101).success).toBe(false);
    expect(dateSchema.safeParse(new Date("2024-01-01")).success).toBe(false);
    expect(dateSchema.safeParse(undefined).success).toBe(false);
    expect(dateSchema.safeParse(null).success).toBe(false);
  });

  it("does not validate calendar correctness (documented current behavior)", () => {
    // The regex only checks digit shape (\d{4}-\d{2}-\d{2}), not that the
    // month is 01-12 or the day is valid for the month. This is not
    // enforced today -- documenting it rather than treating it as a bug.
    expect(dateSchema.safeParse("2024-13-01").success).toBe(true);
    expect(dateSchema.safeParse("2024-02-30").success).toBe(true);
    expect(dateSchema.safeParse("2024-00-00").success).toBe(true);
  });
});

describe("dateTimeSchema", () => {
  it("accepts a well-formed full datetime", () => {
    expect(dateTimeSchema.safeParse("2024-01-01 12:30:00").success).toBe(true);
  });

  it("rejects a plain date without time", () => {
    expect(dateTimeSchema.safeParse("2024-01-01").success).toBe(false);
  });

  it("rejects a datetime missing seconds", () => {
    expect(dateTimeSchema.safeParse("2024-01-01 12:30").success).toBe(false);
  });

  it("rejects a datetime using 'T' separator (ISO 8601 style)", () => {
    expect(dateTimeSchema.safeParse("2024-01-01T12:30:00").success).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(dateTimeSchema.safeParse(undefined).success).toBe(false);
    expect(dateTimeSchema.safeParse(null).success).toBe(false);
  });
});

describe("currencySchema", () => {
  it("accepts valid currency codes", () => {
    for (const code of ["EUR", "USD", "GBP", "CHF", "JPY"]) {
      expect(currencySchema.safeParse(code).success).toBe(true);
    }
  });

  it("rejects an unlisted currency code", () => {
    expect(currencySchema.safeParse("XYZ").success).toBe(false);
  });

  it("rejects a wrongly-cased currency code", () => {
    expect(currencySchema.safeParse("eur").success).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(currencySchema.safeParse(123).success).toBe(false);
    expect(currencySchema.safeParse(undefined).success).toBe(false);
  });
});

describe("receiptTypeSchema", () => {
  const values = [
    "invoice inbound",
    "invoice outbound",
    "credit inbound",
    "credit outbound",
  ] as const;

  it("accepts every literal value in the enum", () => {
    for (const value of values) {
      expect(receiptTypeSchema.safeParse(value).success).toBe(true);
    }
  });

  it("rejects an arbitrary unlisted string", () => {
    expect(receiptTypeSchema.safeParse("invoice sideways").success).toBe(false);
  });
});

describe("vatCodeSchema", () => {
  const values = [
    "0_none",
    "19_vat",
    "7_vat",
    "19_pre",
    "7_pre",
    "19_both_1",
    "19_both_2",
    "7_both",
    "19_both_1_no_pre",
    "19_both_2_no_pre",
    "7_both_no_pre",
    "19_pre_app",
    "7_pre_app",
    "19_both_app_1",
    "19_both_app_2",
    "7_both_app",
    "19_both_506",
    "19_both_6506",
    "19_both_511",
    "19_both_6511",
    "19_both_6501",
    "19_both_app_506",
    "19_both_app_511",
  ] as const;

  it("accepts every literal value in the enum", () => {
    for (const value of values) {
      expect(vatCodeSchema.safeParse(value).success).toBe(true);
    }
  });

  it("rejects an arbitrary unlisted string", () => {
    expect(vatCodeSchema.safeParse("99_vat").success).toBe(false);
  });
});

describe("eInvoiceTaxTypeSchema", () => {
  const values = ["S", "Z", "AE", "K", "G", "E"] as const;

  it("accepts every literal value in the enum", () => {
    for (const value of values) {
      expect(eInvoiceTaxTypeSchema.safeParse(value).success).toBe(true);
    }
  });

  it("rejects an arbitrary unlisted string", () => {
    expect(eInvoiceTaxTypeSchema.safeParse("X").success).toBe(false);
  });
});

describe("listDirectionSchema", () => {
  const values = ["inbound", "outbound"] as const;

  it("accepts every literal value in the enum", () => {
    for (const value of values) {
      expect(listDirectionSchema.safeParse(value).success).toBe(true);
    }
  });

  it("rejects an arbitrary unlisted string", () => {
    expect(listDirectionSchema.safeParse("sideways").success).toBe(false);
  });
});

describe("invoiceTypeSchema", () => {
  const values = ["invoice", "credit", "offer"] as const;

  it("accepts every literal value in the enum", () => {
    for (const value of values) {
      expect(invoiceTypeSchema.safeParse(value).success).toBe(true);
    }
  });

  it("rejects an arbitrary unlisted string", () => {
    expect(invoiceTypeSchema.safeParse("quote").success).toBe(false);
  });
});

describe("accountTypeSchema", () => {
  const values = ["cash", "bank/institution", "other"] as const;

  it("accepts every literal value in the enum", () => {
    for (const value of values) {
      expect(accountTypeSchema.safeParse(value).success).toBe(true);
    }
  });

  it("rejects an arbitrary unlisted string", () => {
    expect(accountTypeSchema.safeParse("crypto").success).toBe(false);
  });
});

describe("showPricesTypeSchema", () => {
  const values = ["net", "gross"] as const;

  it("accepts every literal value in the enum", () => {
    for (const value of values) {
      expect(showPricesTypeSchema.safeParse(value).success).toBe(true);
    }
  });

  it("rejects an arbitrary unlisted string", () => {
    expect(showPricesTypeSchema.safeParse("total").success).toBe(false);
  });
});
