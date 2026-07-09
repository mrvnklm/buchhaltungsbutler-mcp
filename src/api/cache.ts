export class CacheManager {
  private store = new Map<string, { value: unknown; expiresAt: number }>();

  static readonly CACHE_TTLS: Record<string, number> = {
    "/accounts/get": 86_400_000,
    "/settings/get/postingaccounts": 86_400_000,
    "/cost-locations/get": 86_400_000,
    "/settings/get/debtors": 7_200_000,
    "/settings/get/creditors": 7_200_000,
  };

  // Note: `/settings/get/postingaccounts` is a unified listing that also includes
  // payment accounts, debtors, and creditors (see manage_posting_accounts' exclude_*
  // flags in settings.ts), so writes to any of those must invalidate it too, not
  // just the accounts/debtors/creditors' own list endpoints.
  static readonly INVALIDATION_MAP: Record<string, string[]> = {
    "/accounts/add": ["/accounts/get", "/settings/get/postingaccounts"],
    "/settings/add/postingaccount": ["/settings/get/postingaccounts"],
    "/settings/update/postingaccount": ["/settings/get/postingaccounts"],
    "/cost-locations/add": ["/cost-locations/get"],
    "/cost-locations/update": ["/cost-locations/get"],
    "/cost-locations/delete": ["/cost-locations/get"],
    "/settings/add/debtor": ["/settings/get/debtors", "/settings/get/postingaccounts"],
    "/settings/add-batch/debtors": ["/settings/get/debtors", "/settings/get/postingaccounts"],
    "/settings/update/debtor": ["/settings/get/debtors", "/settings/get/postingaccounts"],
    "/settings/add/creditor": ["/settings/get/creditors", "/settings/get/postingaccounts"],
    "/settings/add-batch/creditors": ["/settings/get/creditors", "/settings/get/postingaccounts"],
    "/settings/update/creditor": ["/settings/get/creditors", "/settings/get/postingaccounts"],
  };

  buildKey(path: string, params: Record<string, unknown>): string {
    const sorted = Object.entries(params)
      .filter(([k]) => k !== "api_key")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${String(v)}`)
      .join("&");
    return sorted ? `${path}?${sorted}` : path;
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  invalidate(pathPrefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(pathPrefix)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }

  isCacheable(path: string): boolean {
    return path in CacheManager.CACHE_TTLS;
  }

  getTtlForEndpoint(path: string): number {
    return CacheManager.CACHE_TTLS[path] ?? 0;
  }

  invalidateForWrite(writePath: string): void {
    const prefixes = CacheManager.INVALIDATION_MAP[writePath];
    if (!prefixes) return;
    for (const prefix of prefixes) {
      this.invalidate(prefix);
    }
  }
}
