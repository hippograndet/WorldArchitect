/**
 * Suggested infobox field keys per template type — a UI hint list, not a
 * validation schema. See dev-docs/future/design_article_metadata.md.
 */
export const SUGGESTED_METADATA_FIELDS: Record<string, string[]> = {
  character: ['species', 'affiliation', 'age', 'status', 'title'],
  location: ['population', 'ruler', 'founded', 'region'],
  faction: ['leader', 'ideology', 'founded', 'headquarters'],
  historical_event: ['date', 'participants', 'outcome'],
  general: [],
};

export function suggestedMetadataFields(templateType: string): string[] {
  return SUGGESTED_METADATA_FIELDS[templateType] ?? [];
}
