import type { TemplateType } from '../types/article.ts';

export interface ArticleMetadataFieldDefinition {
  key: string;
  label: string;
  scope: 'general' | 'type';
  valueType: 'text';
  description: string;
}

export interface ArticleTypeDefinition {
  id: TemplateType;
  label: string;
  description: string;
  metadataFields: ArticleMetadataFieldDefinition[];
}

export const GENERAL_METADATA_FIELDS: ArticleMetadataFieldDefinition[] = [
  {
    key: 'aka',
    label: 'Also known as',
    scope: 'general',
    valueType: 'text',
    description: 'Alternate names, aliases, or common short forms for this article subject.',
  },
];

export const ARTICLE_TYPES: ArticleTypeDefinition[] = [
  {
    id: 'general',
    label: 'General',
    description: 'A flexible article for concepts that do not yet need a specialized structure.',
    metadataFields: [],
  },
  {
    id: 'character',
    label: 'Person / Character',
    description: 'A person, character, lineage figure, or named individual.',
    metadataFields: [
      { key: 'origin', label: 'Origin', scope: 'type', valueType: 'text', description: 'Where this person comes from, if known.' },
    ],
  },
  {
    id: 'location',
    label: 'Location',
    description: 'A place, region, settlement, landmark, or geographic feature.',
    metadataFields: [
      { key: 'region', label: 'Region', scope: 'type', valueType: 'text', description: 'The larger area this location belongs to.' },
    ],
  },
  {
    id: 'faction',
    label: 'Organization / Faction',
    description: 'A group, institution, government, faction, or organized movement.',
    metadataFields: [
      { key: 'leader', label: 'Leader', scope: 'type', valueType: 'text', description: 'The current or most relevant leader.' },
    ],
  },
  {
    id: 'historical_event',
    label: 'Event',
    description: 'A significant incident, era, conflict, discovery, or turning point.',
    metadataFields: [],
  },
];
