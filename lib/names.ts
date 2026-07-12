// Natural-language name list for outbound copy: "Matt", "Matt and Scott",
// "Matt, Scott and Ana". The UI roster uses " + " (makerRoster); email prose
// reads better with "and".
export function joinNames(names: string[]): string {
  const clean = names.map((n) => n.trim()).filter(Boolean)
  if (clean.length <= 1) return clean[0] || ''
  return `${clean.slice(0, -1).join(', ')} and ${clean[clean.length - 1]}`
}
