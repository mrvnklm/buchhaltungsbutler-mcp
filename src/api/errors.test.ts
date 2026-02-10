import { describe, it, expect } from "vitest";
import { ApiError } from "./errors.js";

describe("ApiError", () => {
  describe("isTransient", () => {
    it("returns true for rate limit error (code 15)", () => {
      const error = new ApiError(15, 429);
      expect(error.isTransient()).toBe(true);
    });

    it("returns true for timeout error (code 30)", () => {
      const error = new ApiError(30, 504);
      expect(error.isTransient()).toBe(true);
    });

    it("returns false for auth error (code 3)", () => {
      const error = new ApiError(3, 401);
      expect(error.isTransient()).toBe(false);
    });

    it("returns false for invalid data error (code 8)", () => {
      const error = new ApiError(8, 400);
      expect(error.isTransient()).toBe(false);
    });

    it("returns false for internal server error (code 0)", () => {
      const error = new ApiError(0, 500);
      expect(error.isTransient()).toBe(false);
    });
  });

  describe("isTransientError (static)", () => {
    it("returns true for transient ApiError", () => {
      expect(ApiError.isTransientError(new ApiError(15, 429))).toBe(true);
      expect(ApiError.isTransientError(new ApiError(30, 504))).toBe(true);
    });

    it("returns false for non-transient ApiError", () => {
      expect(ApiError.isTransientError(new ApiError(3, 401))).toBe(false);
      expect(ApiError.isTransientError(new ApiError(8, 400))).toBe(false);
    });

    it("returns true for TypeError (network failure)", () => {
      expect(ApiError.isTransientError(new TypeError("Failed to fetch"))).toBe(true);
    });

    it("returns false for generic Error", () => {
      expect(ApiError.isTransientError(new Error("something"))).toBe(false);
    });

    it("returns false for non-Error values", () => {
      expect(ApiError.isTransientError("string")).toBe(false);
      expect(ApiError.isTransientError(null)).toBe(false);
      expect(ApiError.isTransientError(undefined)).toBe(false);
      expect(ApiError.isTransientError(42)).toBe(false);
    });
  });

  describe("toText", () => {
    it("formats error with code and message", () => {
      const error = new ApiError(3, 401);
      expect(error.toText()).toBe("Error 3: API credentials unknown or invalid");
    });

    it("uses custom message when provided", () => {
      const error = new ApiError(0, 500, "Custom error message");
      expect(error.toText()).toBe("Error 0: Custom error message");
    });
  });
});
