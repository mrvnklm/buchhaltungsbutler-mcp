import { describe, it, expect } from "vitest";
import { formatList, formatSingle, formatSuccess, formatBatchResult } from "./formatters.js";

describe("formatList", () => {
  it("returns no results message for empty array", () => {
    expect(formatList("Items", [])).toBe("Items: No results found.");
  });

  it("formats items with count", () => {
    const items = [{ name: "Alice", age: 30 }, { name: "Bob", age: 25 }];
    const result = formatList("Users", items);
    expect(result).toContain("Users (2 results)");
    expect(result).toContain("[1] Alice");
    expect(result).toContain("[2] Bob");
    expect(result).toContain("Age: 30");
  });

  it("shows total rows when provided", () => {
    const items = [{ name: "Alice" }];
    const result = formatList("Users", items, 100);
    expect(result).toContain("Users (1 of 100 total)");
  });

  describe("truncation (F5)", () => {
    it("does not truncate when items <= maxItems", () => {
      const items = Array.from({ length: 5 }, (_, i) => ({ name: `Item ${i}` }));
      const result = formatList("Items", items, undefined, { maxItems: 10 });
      expect(result).not.toContain("more items");
      expect(result).toContain("[5]");
    });

    it("truncates when items exceed maxItems", () => {
      const items = Array.from({ length: 20 }, (_, i) => ({ name: `Item ${i}` }));
      const result = formatList("Items", items, undefined, { maxItems: 5 });
      expect(result).toContain("[5]");
      expect(result).not.toContain("[6]");
      expect(result).toContain("... and 15 more items (20 total, showing first 5)");
    });

    it("uses default maxItems of 100", () => {
      const items = Array.from({ length: 105 }, (_, i) => ({ name: `Item ${i}` }));
      const result = formatList("Items", items);
      expect(result).toContain("[100]");
      expect(result).not.toContain("[101]");
      expect(result).toContain("... and 5 more items (105 total, showing first 100)");
    });

    it("shows correct count in header when truncated", () => {
      const items = Array.from({ length: 50 }, (_, i) => ({ name: `Item ${i}` }));
      const result = formatList("Items", items, 200, { maxItems: 10 });
      expect(result).toContain("Items (10 of 200 total)");
      expect(result).toContain("... and 40 more items");
    });

    it("does not truncate for exactly maxItems items", () => {
      const items = Array.from({ length: 10 }, (_, i) => ({ name: `Item ${i}` }));
      const result = formatList("Items", items, undefined, { maxItems: 10 });
      expect(result).not.toContain("more items");
    });

    it("backward compatible when no options provided and items <= 100", () => {
      const items = Array.from({ length: 3 }, (_, i) => ({ name: `Item ${i}` }));
      const result = formatList("Items", items);
      expect(result).toContain("Items (3 results)");
      expect(result).not.toContain("more items");
    });
  });

  describe("note option", () => {
    it("appends the note when provided", () => {
      const items = [{ name: "Alice" }];
      const result = formatList("Items", items, undefined, { note: "Note: something to flag." });
      expect(result).toContain("Note: something to flag.");
    });

    it("omits any trailing note text when not provided", () => {
      const items = [{ name: "Alice" }];
      const result = formatList("Items", items);
      expect(result).not.toContain("Note:");
    });

    it("appends the note after the truncation notice when both apply", () => {
      const items = Array.from({ length: 20 }, (_, i) => ({ name: `Item ${i}` }));
      const result = formatList("Items", items, undefined, { maxItems: 5, note: "Note: pagination stopped early." });
      const truncationIndex = result.indexOf("more items");
      const noteIndex = result.indexOf("Note: pagination stopped early.");
      expect(truncationIndex).toBeGreaterThan(-1);
      expect(noteIndex).toBeGreaterThan(truncationIndex);
    });
  });
});

describe("formatSingle", () => {
  it("formats a single item", () => {
    const result = formatSingle("User", { name: "Alice", email: "alice@test.com" });
    expect(result).toContain("User");
    expect(result).toContain("Name: Alice");
    expect(result).toContain("Email: alice@test.com");
  });

  it("excludes null and undefined values", () => {
    const result = formatSingle("User", { name: "Alice", age: null, email: undefined });
    expect(result).toContain("Name: Alice");
    expect(result).not.toContain("Age");
    expect(result).not.toContain("Email");
  });
});

describe("formatSuccess", () => {
  it("formats success message", () => {
    const result = formatSuccess("Receipt created");
    expect(result).toBe("Success: Receipt created");
  });

  it("includes details", () => {
    const result = formatSuccess("Created", { id: 123, name: "Test" });
    expect(result).toContain("Success: Created");
    expect(result).toContain("Id: 123");
    expect(result).toContain("Name: Test");
  });
});

describe("formatBatchResult", () => {
  it("formats batch results with successes and failures", () => {
    const successes = [{ id_by_customer: 1 }, { id_by_customer: 2 }];
    const errors = [{ error_code: 8, message: "Invalid data" }];
    const result = formatBatchResult("Batch", successes, errors);
    expect(result).toContain("2 succeeded, 1 failed");
    expect(result).toContain("ID: 1");
    expect(result).toContain("Error 8: Invalid data");
  });
});
