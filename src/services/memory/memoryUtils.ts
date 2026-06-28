/**
 * Normalizes a memory string so duplicate detection is consistent
 * regardless of casing, spacing, or trailing punctuation.
 *
 * Steps applied in order:
 *   1. trim()      — remove leading/trailing whitespace
 *   2. toLowerCase — case-insensitive comparison
 *   3. /\s+/ → ' ' — collapse multiple spaces into one
 *   4. /[.,!?;:]+$/ → '' — strip trailing punctuation
 *
 * Examples:
 *   "Aku suka TypeScript."   → "aku suka typescript"
 *   "aku   suka   typescript" → "aku suka typescript"
 *   "User owns RTX 4060!"    → "user owns rtx 4060"
 */
export function normalizeMemory(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:]+$/, '');
}
