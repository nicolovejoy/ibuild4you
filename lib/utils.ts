// Strip markdown code fences from pasted JSON.
// Handles ```json ... ```, ``` ... ```, and bare JSON.
export function stripCodeFences(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```(?:\w+)?\s*\n([\s\S]*?)\n\s*```$/)
  return match ? match[1] : trimmed
}
