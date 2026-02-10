/**
 * Format API responses as LLM-friendly structured text.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

export function formatList(
  title: string,
  items: unknown[],
  totalRows?: number
): string {
  if (items.length === 0) return `${title}: No results found.`;

  const header = totalRows !== undefined
    ? `${title} (${items.length} of ${totalRows} total)`
    : `${title} (${items.length} results)`;

  const formatted = items.map((item, i) => formatItem(item as AnyRecord, i + 1)).join("\n\n");

  return `${header}\n${"─".repeat(50)}\n${formatted}`;
}

export function formatSingle(title: string, item: unknown): string {
  return `${title}\n${"─".repeat(50)}\n${formatItem(item as AnyRecord)}`;
}

export function formatSuccess(message: string, details?: Record<string, unknown>): string {
  let text = `Success: ${message}`;
  if (details) {
    const entries = Object.entries(details)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `  ${formatKey(k)}: ${v}`);
    if (entries.length > 0) text += "\n" + entries.join("\n");
  }
  return text;
}

export function formatBatchResult(
  title: string,
  successes: unknown[],
  errors: unknown[]
): string {
  const lines = [`${title}: ${successes.length} succeeded, ${errors.length} failed`];

  if (successes.length > 0) {
    lines.push("\nSucceeded:");
    for (const item of successes) {
      const s = item as AnyRecord;
      const id = s.id_by_customer ?? s.postingaccount_number ?? s.code ?? "";
      lines.push(`  - ID: ${id}`);
    }
  }

  if (errors.length > 0) {
    lines.push("\nFailed:");
    for (const item of errors) {
      const e = item as AnyRecord;
      lines.push(`  - Error ${e.error_code}: ${e.message}`);
    }
  }

  return lines.join("\n");
}

function formatItem(item: AnyRecord, index?: number): string {
  const prefix = index !== undefined ? `[${index}] ` : "";
  const entries = Object.entries(item)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .filter(([k]) => k !== "file_content") // exclude large base64 blobs from display
    .map(([k, v]) => `  ${formatKey(k)}: ${v}`);
  const label = (item.name as string) ?? (item.counterparty as string) ?? (item.id_by_customer as string) ?? "";
  return `${prefix}${label}\n${entries.join("\n")}`;
}

function formatKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
