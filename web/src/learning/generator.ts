// The "Generate a lesson set" section's helpers: the prompt to paste into a chat LLM, read out of PROMPT.md (served by
// GET /api/learning/generator/PROMPT.md), and sizes for its list of files.

/** The prompt of docs/learning/PROMPT.md: its first ```text fenced block, without the fences, each paragraph on one
 * line (the document wraps its lines; the chat shouldn't see the wrap) and "\n" between paragraphs; null when the
 * document has none */
export function promptOf(markdown: string): string | null {
  const match = /^```text\r?\n([\s\S]*?)\r?\n```[ \t]*$/m.exec(markdown);
  if (!match) return null;
  return match[1].replace(/\r\n/g, "\n").split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n/g, " ").trim()).filter((p) => p.length > 0).join("\n\n");
}

/** A size in bytes as the file list shows it: "512 B", "4 KB", "134 KB", "1.2 MB" (1 KB = 1024 B) */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1000) return `${Math.max(1, Math.round(kb))} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
