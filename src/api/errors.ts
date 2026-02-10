const ERROR_MESSAGES: Record<number, string> = {
  0: "Internal server error",
  3: "API credentials unknown or invalid",
  4: "Customer not found or insufficient privileges",
  8: "Invalid request data",
  11: "Customer has no active status",
  15: "Rate limit exceeded - temporarily restricted",
  23: "No post content received or request declined",
  30: "Request timeout",
};

export class ApiError extends Error {
  constructor(
    public readonly errorCode: number,
    public readonly httpStatus: number,
    message?: string
  ) {
    super(message ?? ERROR_MESSAGES[errorCode] ?? `Unknown error (code ${errorCode})`);
    this.name = "ApiError";
  }

  toText(): string {
    return `Error ${this.errorCode}: ${this.message}`;
  }
}
