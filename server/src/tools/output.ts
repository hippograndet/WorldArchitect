import type { Tool, ToolParamSchema } from './types.js';

// ---------------------------------------------------------------------------
// Shared sub-schemas
// ---------------------------------------------------------------------------

const coherenceWarningSchema: ToolParamSchema = {
  type: 'object',
  properties: {
    severity: { type: 'string', enum: ['warning', 'conflict'], description: 'Warning severity' },
    description: { type: 'string', description: 'Detailed description of the issue' },
    sourceArticleId: { type: 'string', description: 'Article ID where the contradiction originates (optional)' },
  },
  required: ['severity', 'description'],
};

const suggestedLinkSchema: ToolParamSchema = {
  type: 'object',
  properties: {
    targetArticleTitle: { type: 'string', description: 'Title of the article to link to' },
    targetArticleId: { type: 'string', description: 'Article ID if known' },
  },
  required: ['targetArticleTitle'],
};

const stubItemSchema: ToolParamSchema = {
  type: 'object',
  properties: {
    categoryName: { type: 'string', description: 'Category this stub belongs to (exact name)' },
    title: { type: 'string', description: 'Specific, evocative article title' },
    summary: { type: 'string', description: '1-paragraph Introduction for the World Bible' },
    templateType: {
      type: 'string',
      enum: ['general', 'character', 'location', 'faction'],
      description: 'Article template type',
    },
  },
  required: ['categoryName', 'title', 'summary', 'templateType'],
};

const proposalItemSchema: ToolParamSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short creative direction title (3–8 words)' },
    direction: { type: 'string', description: 'Creative angle description (~60 words)' },
  },
  required: ['title', 'direction'],
};

const childProposalItemSchema: ToolParamSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Specific, evocative article title' },
    introduction: { type: 'string', description: '1-paragraph Introduction for this child article' },
    templateType: {
      type: 'string',
      enum: ['general', 'character', 'location', 'faction'],
      description: 'Article template type',
    },
  },
  required: ['title', 'introduction', 'templateType'],
};

const temporalAnchorSchema: ToolParamSchema = {
  type: 'object',
  properties: {
    start: { type: 'string', description: 'Start date or era string' },
    end: { type: 'string', description: 'End date or era string (optional)' },
  },
  required: ['start'],
};

const retentionIssueSchema: ToolParamSchema = {
  type: 'object',
  properties: {
    description: { type: 'string', description: 'Description of the lost or distorted fact' },
    severity: { type: 'string', enum: ['warning', 'critical'], description: 'Issue severity' },
  },
  required: ['description', 'severity'],
};

// ---------------------------------------------------------------------------
// Output tools — one per agent
// ---------------------------------------------------------------------------

export const OUTPUT_TOOLS: Record<string, Tool> = {
  // SkeletonAgent: initial world stubs
  submit_stubs: {
    name: 'submit_stubs',
    description: 'Submit the generated article stubs for the new world.',
    inputSchema: {
      type: 'object',
      properties: {
        stubs: {
          type: 'array',
          description: 'Array of article stubs, 2–4 per category',
          items: stubItemSchema,
        },
      },
      required: ['stubs'],
    },
  },

  // ProposalAgent: 3 creative direction proposals
  submit_proposals: {
    name: 'submit_proposals',
    description: 'Submit exactly 3 creative direction proposals for the user to choose from.',
    inputSchema: {
      type: 'object',
      properties: {
        proposals: {
          type: 'array',
          description: 'Exactly 3 creative direction proposals',
          items: proposalItemSchema,
        },
      },
      required: ['proposals'],
    },
  },

  // Expander: writes the ## Description section (expand_description / create_root modes)
  submit_description: {
    name: 'submit_description',
    description: 'Submit the completed ## Description section for this article.',
    inputSchema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Full ## Description content (3–5 paragraphs, no heading)',
        },
        suggestedLinks: {
          type: 'array',
          description: 'Articles that should be linked from this article',
          items: suggestedLinkSchema,
        },
        temporalAnchor: temporalAnchorSchema,
      },
      required: ['description'],
    },
  },

  // Expander: child article mode — writes child Description + parent append text
  submit_child_description: {
    name: 'submit_child_description',
    description: 'Submit the child article Description and the text to append to the parent article.',
    inputSchema: {
      type: 'object',
      properties: {
        childDescription: {
          type: 'string',
          description: 'Full ## Description for the new child article (3–5 paragraphs, no heading)',
        },
        parentAppend: {
          type: 'string',
          description: 'Short paragraph (1–2 sentences) to append to the parent Description acknowledging this child',
        },
        suggestedLinks: {
          type: 'array',
          description: 'Articles that should be linked from the child article',
          items: suggestedLinkSchema,
        },
        temporalAnchor: temporalAnchorSchema,
      },
      required: ['childDescription', 'parentAppend'],
    },
  },

  // Summarizer: derives Introduction (1 para) from Description
  submit_introduction: {
    name: 'submit_introduction',
    description: 'Submit the 1-paragraph Introduction derived from the article Description.',
    inputSchema: {
      type: 'object',
      properties: {
        introduction: {
          type: 'string',
          description: 'One concise paragraph summarising the article for the World Bible',
        },
      },
      required: ['introduction'],
    },
  },

  // ChildProposer: 10 child article proposals
  submit_child_proposals: {
    name: 'submit_child_proposals',
    description: 'Submit 10 child article proposals for the user to select from.',
    inputSchema: {
      type: 'object',
      properties: {
        proposals: {
          type: 'array',
          description: 'Exactly 10 child article proposals',
          items: childProposalItemSchema,
        },
      },
      required: ['proposals'],
    },
  },

  // Chronicler: writes the ## Chronology section
  submit_chronology: {
    name: 'submit_chronology',
    description: 'Submit the completed ## Chronology section for this article.',
    inputSchema: {
      type: 'object',
      properties: {
        chronologySection: {
          type: 'string',
          description: 'Full ## Chronology content (no heading). List events in chronological order.',
        },
      },
      required: ['chronologySection'],
    },
  },

  // CoherenceAgent: detects contradictions and suggests links
  submit_coherence_check: {
    name: 'submit_coherence_check',
    description: 'Submit the results of the coherence check.',
    inputSchema: {
      type: 'object',
      properties: {
        warnings: {
          type: 'array',
          description: 'Detected contradictions or consistency issues',
          items: coherenceWarningSchema,
        },
        suggestedLinks: {
          type: 'array',
          description: 'Cross-links that should be added',
          items: suggestedLinkSchema,
        },
      },
      required: ['warnings', 'suggestedLinks'],
    },
  },

  // RetentionAgent: verifies reorganize preserved all facts
  submit_retention_check: {
    name: 'submit_retention_check',
    description: 'Submit the results of the retention check (verify no facts were lost during reorganization).',
    inputSchema: {
      type: 'object',
      properties: {
        passed: { type: 'boolean', description: 'Whether all facts were retained' },
        issues: {
          type: 'array',
          description: 'Facts that appear to have been lost or distorted',
          items: retentionIssueSchema,
        },
      },
      required: ['passed', 'issues'],
    },
  },

  // BibleCompressor: bulk preview of compressed World Bible entries
  submit_compression: {
    name: 'submit_compression',
    description: 'Submit compressed World Bible entries (preview only — not applied automatically).',
    inputSchema: {
      type: 'object',
      properties: {
        entries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              articleId: { type: 'string', description: 'Article ID' },
              compressedSummary: { type: 'string', description: 'New compressed Introduction' },
              tokensBefore: { type: 'number', description: 'Token count before compression' },
              tokensAfter: { type: 'number', description: 'Token count after compression' },
            },
            required: ['articleId', 'compressedSummary', 'tokensBefore', 'tokensAfter'],
          },
        },
      },
      required: ['entries'],
    },
  },
};
