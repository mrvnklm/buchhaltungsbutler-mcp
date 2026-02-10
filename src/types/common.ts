export interface BbConfig {
  apiClient: string;
  apiSecret: string;
  apiKey: string;
  baseUrl: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  error_code?: number;
  rows?: number;
  data?: T;
}

export interface BatchResponse<T = unknown> {
  success: boolean;
  errors?: Array<{
    success: false;
    error_code: number;
    message: string;
    request_data?: unknown;
  }>;
  [key: string]: unknown;
}

export type RateLimitBucket = "general" | "batch" | "upload";
