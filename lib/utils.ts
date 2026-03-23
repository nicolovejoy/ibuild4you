// Strip markdown code fences from pasted JSON.
// Handles ```json ... ```, ``` ... ```, and bare JSON.
export function stripCodeFences(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```(?:\w+)?\s*\n([\s\S]*?)\n\s*```$/)
  return match ? match[1] : trimmed
}

// Generate a URL-safe slug from a title.
// "Louise's Bakery App" → "louises-bakery-app"
export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9\s-]/g, '')   // strip non-alphanumeric
    .trim()
    .replace(/\s+/g, '-')           // spaces → hyphens
    .replace(/-+/g, '-')            // collapse multiple hyphens
}
