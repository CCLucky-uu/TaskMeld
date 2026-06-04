export function truncateOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text

  const half = Math.floor(maxChars / 2)
  const head = text.slice(0, half)
  const tail = text.slice(-half)
  const omitted = text.length - maxChars

  return `${head}\n\n... (${omitted} characters omitted) ...\n\n${tail}`
}
