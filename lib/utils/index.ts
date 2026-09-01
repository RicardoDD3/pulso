/**
 * Pure utility functions extracted from API routes for testability
 */

// ============================================================================
// Data URL Parsing
// ============================================================================

export interface ParsedDataUrl {
  mimeType: string;
  data: string;
}

/**
 * Parses a data URL and extracts the mime type and base64 data
 * @param dataUrl - The data URL string (e.g., "data:image/png;base64,...")
 * @returns Parsed data or null if invalid format
 */
export function parseDataUrl(dataUrl: string): ParsedDataUrl | null {
  if (!dataUrl || typeof dataUrl !== "string") {
    return null;
  }
  const match = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

// ============================================================================
// ID Validation
// ============================================================================

export interface ParsedId {
  valid: boolean;
  id: number;
}

/**
 * Parses and validates a numeric ID string
 * @param idString - The ID string to parse
 * @returns Object with validation result and parsed ID
 */
export function parseNumericId(idString: string): ParsedId {
  if (!idString || typeof idString !== "string") {
    return { valid: false, id: 0 };
  }
  // Use strict parsing - must be a valid integer string
  const trimmed = idString.trim();
  const id = parseInt(trimmed, 10);

  // Check: not NaN, positive, is integer, and string exactly matches parsed number
  const isValid = !isNaN(id) && id > 0 && Number.isInteger(id) && String(id) === trimmed;

  return {
    valid: isValid,
    id: isNaN(id) ? 0 : id,
  };
}
