// Client-side section parsing mirrors server/src/services/sections.ts

function extractSection(body: string, heading: string): string {
  // Split on any ## heading at the start of a line (handles adjacent headings with no blank line)
  const parts = body.split(/^(?=## )/m);
  const section = parts.find((p) => p.startsWith(heading));
  if (!section) return '';
  return section.slice(heading.length).trim();
}

export function extractDescription(body: string): string {
  return extractSection(body, '## Description');
}

export function extractChronology(body: string): string {
  return extractSection(body, '## Chronology');
}

export function mergeDescription(body: string, newDescription: string): string {
  const chronologyMatch = body.match(/(## Chronology[\s\S]*)$/);
  const chronologyPart = chronologyMatch?.[1] ?? '## Chronology';
  return `## Description\n\n${newDescription}\n\n${chronologyPart}`;
}

export function mergeChronology(body: string, newChronology: string): string {
  const descPart = body.replace(/\n## Chronology[\s\S]*$/, '').trim();
  const safeDesc = descPart || '## Description';
  return `${safeDesc}\n\n## Chronology\n\n${newChronology}`;
}
