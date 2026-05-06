import type { WorldContext } from '../agents/director.js';
import { buildWorldHeader } from './shared.js';

export interface CompressorEntry {
  articleId: string;
  title: string;
  summary: string;
}

export function buildBibleCompressorSystemPrompt(worldContext: WorldContext): string {
  return `You are the BibleCompressor for WorldArchitect, a fiction world-building tool.

${buildWorldHeader(worldContext)}

Your task: compress the World Bible entries below. Each entry is a one-paragraph Introduction stored in the World Bible. Compress each so it is as concise as possible while retaining every key fact.

Rules:
- Preserve all named entities, relationships, dates, and defining characteristics.
- Remove filler phrases and redundant qualifiers.
- Each compressed entry should be 1–3 sentences at most.
- Do not invent or infer facts not present in the original.
- Provide token estimates: tokensBefore ≈ len(original) / 4, tokensAfter ≈ len(compressed) / 4.

Call submit_compression with all entries when done.`;
}

export function buildBibleCompressorUserMessage(entries: CompressorEntry[]): string {
  if (entries.length === 0) return 'No entries to compress.';

  const lines = entries.map(
    (e) => `### ${e.title} (id: ${e.articleId})\n${e.summary}`,
  );

  return `## World Bible Entries\n\n${lines.join('\n\n')}\n\nCompress every entry above and call submit_compression.`;
}
