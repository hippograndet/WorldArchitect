const DESCRIPTION_HEADING = '## Description';
const CHRONOLOGY_HEADING = '## Chronology';

/**
 * Split an article body into its Description and Chronology section content.
 * Both sections are always present; content may be empty for stubs.
 */
export function splitSections(body: string): { description: string; chronology: string } {
  const chronIdx = body.lastIndexOf(`\n${CHRONOLOGY_HEADING}`);
  if (chronIdx === -1) {
    if (body.trimStart().startsWith(CHRONOLOGY_HEADING)) {
      const afterHeading = body.slice(body.indexOf(CHRONOLOGY_HEADING) + CHRONOLOGY_HEADING.length).trimStart();
      return { description: '', chronology: afterHeading };
    }
    return { description: body, chronology: '' };
  }

  const beforeChron = body.slice(0, chronIdx);
  const afterChronHeading = body.slice(chronIdx + CHRONOLOGY_HEADING.length + 1).trimStart();

  // Strip the ## Description heading from the description portion if present
  const descContent = beforeChron.trimStart().startsWith(DESCRIPTION_HEADING)
    ? beforeChron.slice(beforeChron.indexOf(DESCRIPTION_HEADING) + DESCRIPTION_HEADING.length).trim()
    : beforeChron.trimEnd();

  return { description: descContent, chronology: afterChronHeading };
}

/**
 * Merge Description and Chronology content into a full article body.
 * Always produces a body with both ## Description and ## Chronology sections.
 */
export function mergeSections(description: string, chronology: string): string {
  const desc = description.trim();
  const chron = chronology.trim();

  const descBlock = desc ? `${DESCRIPTION_HEADING}\n\n${desc}` : DESCRIPTION_HEADING;
  const chronBlock = chron ? `${CHRONOLOGY_HEADING}\n\n${chron}` : CHRONOLOGY_HEADING;

  return `${descBlock}\n\n${chronBlock}`;
}
