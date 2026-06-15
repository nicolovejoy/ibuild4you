// Strip markdown code fences from pasted JSON.
// Handles ```json ... ```, ``` ... ```, and bare JSON.
export function stripCodeFences(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```(?:\w+)?\s*\n([\s\S]*?)\n\s*```$/)
  return match ? match[1] : trimmed
}

// Repair structurally-breaking characters in pasted JSON: smart quotes used as
// delimiters and non-breaking spaces. Run this ONLY as a fallback after a normal
// parse fails — so legitimate content (a curly apostrophe inside "Sam's Cafe",
// which is valid JSON and parses on the first try) is never rewritten.
function repairJsonStructure(text: string): string {
  return text
    .replace(/[   ﻿]/g, ' ') // non-breaking / narrow spaces, BOM → space
    .replace(/[“”„‟″]/g, '"') // “ ” „ ‟ ″ → "
    .replace(/[‘’‚‛′]/g, "'") // ‘ ’ ‚ ‛ ′ → '
}

// Parse pasted JSON tolerantly: strip code fences and parse; on failure, retry
// once after repairing structure-breaking characters (smart quotes used as
// delimiters, non-breaking spaces). Valid input parses on the first pass and is
// never altered, so apostrophes/quotes inside string values are preserved
// byte-for-byte. Throws SyntaxError if still unparseable after the repair.
export function parseLooseJson(text: string): unknown {
  const stripped = stripCodeFences(text)
  try {
    return JSON.parse(stripped)
  } catch {
    return JSON.parse(repairJsonStructure(stripped))
  }
}

// Generate a URL-safe slug from a title.
// "Sam's Cafe App" → "sams-cafe-app"
export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9\s-]/g, '')   // strip non-alphanumeric
    .trim()
    .replace(/\s+/g, '-')           // spaces → hyphens
    .replace(/-+/g, '-')            // collapse multiple hyphens
}
