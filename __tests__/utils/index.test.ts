import { parseDataUrl, parseNumericId } from "@/lib/utils";

// ============================================================================
// parseDataUrl Tests
// ============================================================================

describe("parseDataUrl", () => {
  describe("valid data URLs", () => {
    it("should parse PNG image data URL", () => {
      const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      const result = parseDataUrl(dataUrl);

      expect(result).not.toBeNull();
      expect(result?.mimeType).toBe("image/png");
      expect(result?.data).toBe("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");
    });

    it("should parse JPEG image data URL", () => {
      const dataUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD";
      const result = parseDataUrl(dataUrl);

      expect(result).not.toBeNull();
      expect(result?.mimeType).toBe("image/jpeg");
      expect(result?.data).toBe("/9j/4AAQSkZJRgABAQEASABIAAD");
    });

    it("should parse PDF data URL", () => {
      const dataUrl = "data:application/pdf;base64,JVBERi0xLjQKJcOkw7zDtsO";
      const result = parseDataUrl(dataUrl);

      expect(result).not.toBeNull();
      expect(result?.mimeType).toBe("application/pdf");
      expect(result?.data).toBe("JVBERi0xLjQKJcOkw7zDtsO");
    });

    it("should parse WebP image data URL", () => {
      const dataUrl = "data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=";
      const result = parseDataUrl(dataUrl);

      expect(result).not.toBeNull();
      expect(result?.mimeType).toBe("image/webp");
    });

    it("should parse text/plain data URL", () => {
      const dataUrl = "data:text/plain;base64,SGVsbG8gV29ybGQ=";
      const result = parseDataUrl(dataUrl);

      expect(result).not.toBeNull();
      expect(result?.mimeType).toBe("text/plain");
      expect(result?.data).toBe("SGVsbG8gV29ybGQ=");
    });
  });

  describe("invalid data URLs", () => {
    it("should return null for empty string", () => {
      expect(parseDataUrl("")).toBeNull();
    });

    it("should return null for null input", () => {
      expect(parseDataUrl(null as unknown as string)).toBeNull();
    });

    it("should return null for undefined input", () => {
      expect(parseDataUrl(undefined as unknown as string)).toBeNull();
    });

    it("should return null for non-string input", () => {
      expect(parseDataUrl(123 as unknown as string)).toBeNull();
    });

    it("should return null for URL without data: prefix", () => {
      expect(parseDataUrl("image/png;base64,abc123")).toBeNull();
    });

    it("should return null for URL without base64 marker", () => {
      expect(parseDataUrl("data:image/png,abc123")).toBeNull();
    });

    it("should return null for URL without mime type", () => {
      expect(parseDataUrl("data:;base64,abc123")).toBeNull();
    });

    it("should return null for regular URL", () => {
      expect(parseDataUrl("https://example.com/image.png")).toBeNull();
    });

    it("should return null for malformed data URL", () => {
      expect(parseDataUrl("data:image/png;base64")).toBeNull();
    });
  });
});

// ============================================================================
// parseNumericId Tests
// ============================================================================

describe("parseNumericId", () => {
  describe("valid IDs", () => {
    it("should parse positive integer string", () => {
      const result = parseNumericId("123");
      expect(result.valid).toBe(true);
      expect(result.id).toBe(123);
    });

    it("should parse single digit ID", () => {
      const result = parseNumericId("1");
      expect(result.valid).toBe(true);
      expect(result.id).toBe(1);
    });

    it("should parse large ID", () => {
      const result = parseNumericId("9999999");
      expect(result.valid).toBe(true);
      expect(result.id).toBe(9999999);
    });
  });

  describe("invalid IDs", () => {
    it("should be invalid for non-numeric string", () => {
      const result = parseNumericId("abc");
      expect(result.valid).toBe(false);
    });

    it("should be invalid for empty string", () => {
      const result = parseNumericId("");
      expect(result.valid).toBe(false);
    });

    it("should be invalid for zero", () => {
      const result = parseNumericId("0");
      expect(result.valid).toBe(false);
      expect(result.id).toBe(0);
    });

    it("should be invalid for negative number", () => {
      const result = parseNumericId("-5");
      expect(result.valid).toBe(false);
    });

    it("should be invalid for floating point", () => {
      const result = parseNumericId("12.5");
      expect(result.valid).toBe(false);
    });

    it("should be invalid for mixed string", () => {
      const result = parseNumericId("12abc");
      expect(result.valid).toBe(false);
    });

    it("should be invalid for whitespace", () => {
      const result = parseNumericId("   ");
      expect(result.valid).toBe(false);
    });
  });
});
