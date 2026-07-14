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
    nodeKind: {
      type: 'string',
      enum: ['conceptual', 'instance'],
      description: 'Whether this is a conceptual child (a category/type, e.g. Religion under World) or an instance child (a specific entity, e.g. Christianity under Religion)',
    },
    nodeKindRationale: {
      type: 'string',
      description: '1-sentence rationale for the nodeKind classification',
    },
  },
  required: ['title', 'introduction', 'templateType', 'nodeKind', 'nodeKindRationale'],
};

const contradictionItemSchema: ToolParamSchema = {
  type: 'object',
  properties: {
    excerpt:    { type: 'string', description: 'The offending sentence or phrase' },
    issue:      { type: 'string', description: 'What established fact it contradicts' },
    correction: { type: 'string', description: 'Suggested rewrite' },
  },
  required: ['excerpt', 'issue', 'correction'],
};

const retentionIssueSchema: ToolParamSchema = {
  type: 'object',
  properties: {
    description: { type: 'string', description: 'Description of the lost or distorted fact' },
    severity: { type: 'string', enum: ['warning', 'critical'], description: 'Issue severity' },
  },
  required: ['description', 'severity'],
};

const ideaItemSchema: ToolParamSchema = {
  type: 'object',
  properties: {
    theme: { type: 'string', description: 'Short thematic label (3–6 words)' },
    detail: { type: 'string', description: '~40 word elaboration of this theme' },
  },
  required: ['theme', 'detail'],
};

const styleIssueSchema: ToolParamSchema = {
  type: 'object',
  properties: {
    severity: { type: 'string', enum: ['suggestion', 'warning'], description: 'Issue severity' },
    category: { type: 'string', enum: ['clarity', 'tone', 'logic', 'consistency'], description: 'Issue category' },
    description: { type: 'string', description: 'Actionable description of the issue' },
    excerpt: { type: 'string', description: 'The offending excerpt from the text (optional)' },
  },
  required: ['severity', 'category', 'description'],
};

const edgeProposalSchema: ToolParamSchema = {
  type: 'object',
  properties: {
    sourceArticleId: { type: 'string', description: 'ID of the source article' },
    sourceArticleTitle: { type: 'string', description: 'Title of the source article' },
    targetArticleId: { type: 'string', description: 'ID of the target article' },
    targetArticleTitle: { type: 'string', description: 'Title of the target article' },
    linkType: { type: 'string', enum: ['references', 'hierarchical'], description: 'Type of link' },
    rationale: { type: 'string', description: '1-sentence rationale for this link' },
  },
  required: ['sourceArticleId', 'sourceArticleTitle', 'targetArticleId', 'targetArticleTitle', 'linkType', 'rationale'],
};

const globalWarningSchema: ToolParamSchema = {
  type: 'object',
  properties: {
    severity: { type: 'string', enum: ['warning', 'conflict'], description: 'Issue severity' },
    type: { type: 'string', enum: ['coherence', 'gap', 'narrative', 'thematic'], description: 'Issue category: coherence (factual contradictions), gap (missing articles for recurring concepts), narrative (incomplete arcs/causality), thematic (tone/genre inconsistency)' },
    description: { type: 'string', description: 'Description of the global coherence issue' },
    involvedArticleIds: { type: 'array', items: { type: 'string' }, description: 'IDs of articles involved in this issue' },
  },
  required: ['severity', 'type', 'description', 'involvedArticleIds'],
};

// ---------------------------------------------------------------------------
// Output tools — one per agent
// ---------------------------------------------------------------------------

export const OUTPUT_TOOLS: Record<string, Tool> = {
  // Scribe: writes the ## Description section (expand_description / create_root modes)
  submit_description: {
    name: 'submit_description',
    description: 'Submit the completed ## Description section for this article.',
    inputSchema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Full ## Description content (no heading)',
        },
        mentions: {
          type: 'array',
          description: 'New significant entities introduced in this description that do not yet exist as world articles. Only include genuinely novel, central entities — not passing references.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'The entity name as it appears in the description' },
              templateType: {
                type: 'string',
                enum: ['general', 'character', 'location', 'faction', 'historical_event'],
                description: 'Entity type',
              },
              summary: { type: 'string', description: '1-sentence summary of this entity distilled from what you wrote' },
            },
            required: ['title', 'templateType'],
          },
        },
      },
      required: ['description'],
    },
  },

  // MentionExtractor: compact entity mention list from an already-written draft
  submit_mentions: {
    name: 'submit_mentions',
    description: 'Submit significant new entity mentions found in an article draft.',
    inputSchema: {
      type: 'object',
      properties: {
        mentions: {
          type: 'array',
          description: 'New significant entities introduced in the draft that do not yet exist as world articles. Only include genuinely novel, central entities.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'The entity name as it appears in the draft' },
              templateType: {
                type: 'string',
                enum: ['general', 'character', 'location', 'faction', 'historical_event'],
                description: 'Entity type',
              },
              summary: { type: 'string', description: '1-sentence summary of this entity distilled from the draft' },
            },
            required: ['title', 'templateType'],
          },
        },
      },
      required: ['mentions'],
    },
  },

  // Scribe: child article mode — writes child Description + parent append text
  submit_child_description: {
    name: 'submit_child_description',
    description: 'Submit the child article Description and the text to append to the parent article.',
    inputSchema: {
      type: 'object',
      properties: {
        childDescription: {
          type: 'string',
          description: 'Full ## Description for the new child article (no heading)',
        },
        parentAppend: {
          type: 'string',
          description: 'Short paragraph (1–2 sentences) to append to the parent Description acknowledging this child',
        },
        mentions: {
          type: 'array',
          description: 'New significant entities introduced in this description that do not yet exist as world articles.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'The entity name' },
              templateType: {
                type: 'string',
                enum: ['general', 'character', 'location', 'faction', 'historical_event'],
              },
              summary: { type: 'string', description: '1-sentence summary' },
            },
            required: ['title', 'templateType'],
          },
        },
      },
      required: ['childDescription', 'parentAppend'],
    },
  },

  // Lorekeeper: derives Introduction (1 para) from Description
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

  // Cartographer: 10 child article proposals
  submit_child_proposals: {
    name: 'submit_child_proposals',
    description: 'Submit up to 10 child article proposals for the user to select from.',
    inputSchema: {
      type: 'object',
      properties: {
        proposals: {
          type: 'array',
          description: 'Up to 10 child article proposals',
          items: childProposalItemSchema,
        },
      },
      required: ['proposals'],
    },
  },

  // Warden: detects contradictions and suggests links
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

  // Sentinel: verifies reorganize preserved all facts
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

  // Curator: selects the best ideas, weighing user preference when given
  submit_taste_selection: {
    name: 'submit_taste_selection',
    description: 'Select the idea indices that best fit the world style and (when given) the user\'s stated preference.',
    inputSchema: {
      type: 'object',
      properties: {
        selectedIndices: {
          type: 'array',
          description: 'Zero-based indices of the selected ideas',
          items: { type: 'number' },
        },
        rationale: { type: 'string', description: '1-sentence rationale for the selection' },
      },
      required: ['selectedIndices', 'rationale'],
    },
  },

  // Stylist: expands a raw style description into a rich brief
  submit_prompt_expansion: {
    name: 'submit_prompt_expansion',
    description: 'Submit the expanded creative brief derived from the user input.',
    inputSchema: {
      type: 'object',
      properties: {
        expandedDescription: {
          type: 'string',
          description: '150–250 word LLM-ready expansion of the user input',
        },
      },
      required: ['expandedDescription'],
    },
  },

  // Stylist (distill mode): patches vibe and writingStyle from inspiration input
  submit_style_patch: {
    name: 'submit_style_patch',
    description: 'Submit the style patch derived from user inspiration. Each field is 1–2 sentences that extend (not replace) the existing Vibe and Writing Style.',
    inputSchema: {
      type: 'object',
      properties: {
        vibe_append: {
          type: 'string',
          description: '1–2 sentences to append to the current Vibe & Atmosphere field',
        },
        writingStyle_append: {
          type: 'string',
          description: '1–2 sentences to append to the current Writing Style field',
        },
      },
      required: ['vibe_append', 'writingStyle_append'],
    },
  },

  // Stylist (charter_assist mode): grouped suggestions for the create-world charter
  submit_charter_suggestions: {
    name: 'submit_charter_suggestions',
    description: 'Submit concise grouped suggestions for the world creation charter fields.',
    inputSchema: {
      type: 'object',
      properties: {
        premiseSuggestions: {
          type: 'array',
          description: '3–6 concise keywords or fragments for Founding Premise',
          items: { type: 'string' },
        },
        authoritySuggestions: {
          type: 'array',
          description: '2–5 concise keywords or fragments for Narrative Authority',
          items: { type: 'string' },
        },
        atmosphereSuggestions: {
          type: 'array',
          description: '3–8 concise keywords or fragments for Atmosphere',
          items: { type: 'string' },
        },
        proseSuggestions: {
          type: 'array',
          description: '3–8 concise keywords or fragments for Prose Style',
          items: { type: 'string' },
        },
        rationale: {
          type: 'string',
          description: 'One short sentence explaining the grouping.',
        },
      },
      required: ['premiseSuggestions', 'authoritySuggestions', 'atmosphereSuggestions', 'proseSuggestions', 'rationale'],
    },
  },

  // Stylist (article_brief mode): structured article spec from rough notes
  submit_article_brief: {
    name: 'submit_article_brief',
    description: 'Submit the structured article specification derived from the user\'s rough notes.',
    inputSchema: {
      type: 'object',
      properties: {
        userSpec: {
          type: 'string',
          description: '2–3 paragraph structured article specification, ready to paste into Spark as the article brief',
        },
      },
      required: ['userSpec'],
    },
  },

  // Stylist (intro_seed mode): polished introduction seed from rough idea
  submit_intro_seed: {
    name: 'submit_intro_seed',
    description: 'Submit the polished introduction seed derived from the user\'s rough idea.',
    inputSchema: {
      type: 'object',
      properties: {
        introduction: {
          type: 'string',
          description: '1–2 paragraph polished introduction suitable as a starting seed for the article\'s Introduction layer',
        },
      },
      required: ['introduction'],
    },
  },

  // Muse: 5–10 thematic ideas grounded in world context + the article's own identity
  submit_ideas: {
    name: 'submit_ideas',
    description: 'Submit 5–10 thematic ideas or content angles to explore in the Description section.',
    inputSchema: {
      type: 'object',
      properties: {
        ideas: {
          type: 'array',
          description: '5 to 10 distinct thematic ideas for the Scribe to incorporate',
          items: ideaItemSchema,
        },
      },
      required: ['ideas'],
    },
  },

  // Style Warden: prose quality and tonal consistency check
  submit_style_check: {
    name: 'submit_style_check',
    description: 'Submit the results of the style and tone review.',
    inputSchema: {
      type: 'object',
      properties: {
        issues: {
          type: 'array',
          description: 'Style and clarity issues found in the text',
          items: styleIssueSchema,
        },
        overallToneMatch: {
          type: 'string',
          enum: ['excellent', 'good', 'off'],
          description: 'Overall assessment of tonal consistency with the world style',
        },
        summary: {
          type: 'string',
          description: '1-sentence overall verdict on the content quality',
        },
      },
      required: ['issues', 'overallToneMatch', 'summary'],
    },
  },

  // Researcher: constraint brief before Scribe writes
  submit_research_brief: {
    name: 'submit_research_brief',
    description: 'Submit the research brief: a prose summary of established facts, watch-out-for tensions, and suggested angles for this article.',
    inputSchema: {
      type: 'object',
      properties: {
        brief: {
          type: 'string',
          description: 'A flowing prose research brief (roughly 100–1200 characters) covering established facts the writer must respect, any known tensions/contradictions to watch for, and unexplored angles worth developing. Weave these together naturally rather than forcing a rigid list.',
        },
      },
      required: ['brief'],
    },
  },

  // Continuity Editor: post-Scribe self-correction check
  submit_continuity_check: {
    name: 'submit_continuity_check',
    description: 'Submit the continuity check result for the draft description.',
    inputSchema: {
      type: 'object',
      properties: {
        approved: {
          type: 'boolean',
          description: 'Whether the description is free of contradictions with established lore',
        },
        contradictions: {
          type: 'array',
          description: 'Specific contradictions found (empty if approved)',
          items: contradictionItemSchema,
        },
      },
      required: ['approved', 'contradictions'],
    },
  },

  // Grounding Check: post-Lorekeeper Inception self-correction check
  submit_grounding_check: {
    name: 'submit_grounding_check',
    description: 'Submit the grounding check result for the draft introduction.',
    inputSchema: {
      type: 'object',
      properties: {
        approved: {
          type: 'boolean',
          description: 'Whether the introduction is free of contradictions with parent articles/fixed points',
        },
        contradictions: {
          type: 'array',
          description: 'Specific contradictions found (empty if approved)',
          items: contradictionItemSchema,
        },
      },
      required: ['approved', 'contradictions'],
    },
  },

  // Dedup Check: post-Cartographer Branching duplicate-proposal check
  submit_dedup_check: {
    name: 'submit_dedup_check',
    description: 'Submit any proposed child articles that are semantic/conceptual duplicates of existing sibling articles.',
    inputSchema: {
      type: 'object',
      properties: {
        duplicates: {
          type: 'array',
          description: 'Proposed children that duplicate an existing sibling (empty if none)',
          items: {
            type: 'object',
            properties: {
              proposalTitle:  { type: 'string', description: 'Title of the proposed child that is a duplicate' },
              matchedExisting: { type: 'string', description: 'Title of the existing sibling article it duplicates' },
              rationale:      { type: 'string', description: 'Why these are the same underlying concept' },
            },
            required: ['proposalTitle', 'matchedExisting', 'rationale'],
          },
        },
      },
      required: ['duplicates'],
    },
  },

  // Linter: semantic issue detection on saved articles
  submit_lint_report: {
    name: 'submit_lint_report',
    description: 'Submit the lint report for this article.',
    inputSchema: {
      type: 'object',
      properties: {
        issues: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              severity:    { type: 'string', enum: ['blocking', 'warning'], description: 'Issue severity' },
              excerpt:     { type: 'string', description: 'The specific passage or field with the issue' },
              explanation: { type: 'string', description: '1–2 sentences: what is wrong and why' },
              suggestion:  { type: 'string', description: '1 sentence: what to change' },
            },
            required: ['severity', 'explanation', 'suggestion'],
          },
        },
      },
      required: ['issues'],
    },
  },

  // Fixer: targeted rewrite of a single offending passage
  submit_fix: {
    name: 'submit_fix',
    description: 'Submit the rewritten passage that resolves the identified issue.',
    inputSchema: {
      type: 'object',
      properties: {
        rewritten_passage: {
          type: 'string',
          description: 'The corrected replacement for the offending excerpt',
        },
      },
      required: ['rewritten_passage'],
    },
  },

  // Auditor: world-wide coherence scan and edge discovery
  submit_audit: {
    name: 'submit_audit',
    description: 'Submit the results of the world-wide coherence audit.',
    inputSchema: {
      type: 'object',
      properties: {
        edgeProposals: {
          type: 'array',
          description: 'Proposed cross-links between articles that are not currently connected',
          items: edgeProposalSchema,
        },
        globalWarnings: {
          type: 'array',
          description: 'Global coherence issues spanning multiple articles',
          items: globalWarningSchema,
        },
      },
      required: ['edgeProposals', 'globalWarnings'],
    },
  },
};
