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
  // Architect: initial world stubs
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

  // Muse: 3–5 creative direction proposals
  submit_proposals: {
    name: 'submit_proposals',
    description: 'Submit 3–5 creative direction proposals for the user to choose from.',
    inputSchema: {
      type: 'object',
      properties: {
        proposals: {
          type: 'array',
          description: '3 to 5 creative direction proposals',
          items: proposalItemSchema,
        },
      },
      required: ['proposals'],
    },
  },

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

  // Curator: selects the best proposal based on world style
  submit_taste_selection: {
    name: 'submit_taste_selection',
    description: 'Select the proposal index that best fits the world style.',
    inputSchema: {
      type: 'object',
      properties: {
        selectedIndex: { type: 'number', description: 'Zero-based index of the selected proposal (0 to 4)' },
        rationale: { type: 'string', description: '1-sentence rationale for the selection' },
      },
      required: ['selectedIndex', 'rationale'],
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

  // Condenser: bulk preview of compressed World Bible entries
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

  // Oracle: 5–10 thematic ideas for Step B expansion
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
    description: 'Submit the research brief: key established facts and constraints for this article.',
    inputSchema: {
      type: 'object',
      properties: {
        keyFacts: {
          type: 'array',
          items: { type: 'string' },
          description: '5–10 established facts about this article and its context that the description MUST respect',
        },
        warnings: {
          type: 'array',
          items: { type: 'string' },
          description: '0–3 potential contradictions or constraints to watch out for',
        },
        suggestedAngles: {
          type: 'array',
          items: { type: 'string' },
          description: '1–3 thematic threads worth developing in the description',
        },
      },
      required: ['keyFacts', 'warnings', 'suggestedAngles'],
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
          items: {
            type: 'object',
            properties: {
              excerpt:    { type: 'string', description: 'The offending sentence or phrase' },
              issue:      { type: 'string', description: 'What established fact it contradicts' },
              correction: { type: 'string', description: 'Suggested rewrite' },
            },
            required: ['excerpt', 'issue', 'correction'],
          },
        },
      },
      required: ['approved', 'contradictions'],
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
