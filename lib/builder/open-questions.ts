// Markdown for the open-questions card (#220): the maker-owned open risks,
// ready to paste into a message to the maker.
export function openQuestionsMarkdown(args: {
  title: string
  makerName: string
  questions: string[]
}): string {
  const { title, makerName, questions } = args
  return `## Open questions for ${makerName} — ${title}\n\n${questions.map((q) => `- ${q}`).join('\n')}\n`
}
