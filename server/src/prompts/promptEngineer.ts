export type PromptEngineerFieldType = 'vibe' | 'writing_style' | 'distill' | 'article_brief' | 'intro_seed' | 'prompt_lab';

const FIELD_INSTRUCTIONS: Record<'vibe' | 'writing_style', string> = {
  vibe: `Expand this feeling into a rich, sensory, atmospheric description a writer could use to calibrate every sentence they write.

Cover: visual palette, sound, smell, emotional register, pacing, what the world feels like to inhabit. Make it concrete and evocative, not abstract. ~150 words.`,

  writing_style: `Turn this style description into a concrete prose guide a writer can follow.

Cover: sentence length and rhythm, POV distance, vocabulary register, what to emphasise, what to avoid, how exposition works, how action is written. Give concrete examples of the approach. ~150 words.`,
};

export function buildPromptEngineerSystemPrompt(): string {
  return `You are the PromptEngineer for WorldArchitect, a fiction world-building tool.

Your task: expand a brief user description into a rich, LLM-ready creative brief that will be injected into agent system prompts.

Write in clear, direct prose. Do not use bullet points or headers in your output. The output will be read by an LLM agent and should function as instruction, not documentation.

Call submit_prompt_expansion when ready.`;
}

export function buildDistillSystemPrompt(): string {
  return `You are a style distiller for WorldArchitect, a fiction world-building tool.

Your task: given raw user inspiration text (names of works, moods, themes, or stylistic notes) and the world's current Vibe and Writing Style fields, produce two short extensions — one for Vibe, one for Writing Style — that absorb what is useful from the inspiration into those fields.

Rules:
- Each extension is 1–2 sentences maximum. Precise and concrete, not vague.
- Do not repeat what is already in the current fields.
- Do not invent content — only translate the user's stated inspiration into style guidance.
- Output must be JSON via submit_style_patch.`;
}

export function buildPromptEngineerUserMessage(
  fieldType: 'vibe' | 'writing_style',
  rawText: string,
  worldName: string,
  worldDescription: string,
): string {
  return `World: ${worldName}
World description: ${worldDescription}

Field type: ${fieldType}
User input: "${rawText}"

${FIELD_INSTRUCTIONS[fieldType]}

Write the expanded description now.`;
}

export function buildArticleBriefSystemPrompt(): string {
  return `You are a world-building consultant for WorldArchitect, a fiction world-building tool.

Your task: the user has rough notes about a world article they want to create. Structure and sharpen their notes into a clear, specific article specification that an AI writer can use as their brief.

The specification should cover: the article's role in the world, key established facts the writer must respect, tone and atmosphere, relevant relationships to other articles, and any important constraints or tensions to explore.

Rules:
- Do not invent facts beyond what the user provides — only structure and sharpen their input.
- Write in 2–3 focused paragraphs. No bullet points or headers.
- The output will be pasted directly into a Spark prompt field and read by an AI writer.

Call submit_article_brief when ready.`;
}

export function buildArticleBriefUserMessage(
  roughNotes: string,
  worldName: string,
  worldDescription: string,
  articleTitle?: string,
  articleType?: string,
): string {
  const titleLine = articleTitle ? `Article title: ${articleTitle}` : '';
  const typeLine  = articleType  ? `Article type: ${articleType}`   : '';
  const context   = [titleLine, typeLine].filter(Boolean).join('\n');

  return `World: ${worldName}
World description: ${worldDescription}
${context ? '\n' + context : ''}

User's rough notes:
"${roughNotes}"

Turn these notes into a structured article specification. Call submit_article_brief.`;
}

export function buildIntroSeedSystemPrompt(): string {
  return `You are a creative writing assistant for WorldArchitect, a fiction world-building tool.

Your task: the user has a rough idea for a world article's introduction. Write a polished 1–2 paragraph introduction that establishes the article's tone, key facts, and voice.

It should read like the opening of a well-crafted encyclopedia entry for this fictional world — authoritative, evocative, and specific.

Rules:
- Do not add facts beyond what the user provides — shape and elevate their input, don't invent.
- The output will be used as a seed for the article's Introduction layer.
- Match the world's tone where possible.

Call submit_intro_seed when ready.`;
}

export function buildIntroSeedUserMessage(
  roughNotes: string,
  worldName: string,
  worldDescription: string,
  articleTitle?: string,
  articleType?: string,
): string {
  const titleLine = articleTitle ? `Article title: ${articleTitle}` : '';
  const typeLine  = articleType  ? `Article type: ${articleType}`   : '';
  const context   = [titleLine, typeLine].filter(Boolean).join('\n');

  return `World: ${worldName}
World description: ${worldDescription}
${context ? '\n' + context : ''}

User's rough intro idea:
"${roughNotes}"

Write a polished 1–2 paragraph introduction. Call submit_intro_seed.`;
}

export function buildPromptLabSystemPrompt(focus?: string): string {
  const focusLine = focus
    ? `\n\nThe user has indicated a focus area: "${focus}". Let this shape how you weight and structure the output — but don't force it if the notes don't support it.`
    : '';
  return `You are a prompt engineer for WorldArchitect, a fiction world-building tool.

Your task: take the user's rough notes and turn them into a tight, directive prompt fragment that an AI writing agent can use directly. The output must be concrete, specific, and instruction-oriented — not vague, decorative, or written as prose narrative. It should read like clear creative direction to a writer, not like the writing itself.${focusLine}

Rules:
- Do not invent facts beyond what the user provides.
- Do not write actual article content — write instructions that will shape content.
- 100–200 words. No headers or bullet points.

Call submit_prompt_expansion when ready.`;
}

export function buildPromptLabUserMessage(
  rawText: string,
  worldName: string,
  worldDescription: string,
  focus?: string,
): string {
  return `World: ${worldName}
World description: ${worldDescription}
${focus ? `\nFocus area: ${focus}` : ''}

User's rough notes:
"${rawText}"

Produce a structured prompt fragment for this world's AI writer.`;
}

export function buildDistillUserMessage(
  rawText: string,
  worldName: string,
  worldDescription: string,
  currentVibe: string,
  currentWritingStyle: string,
): string {
  return `World: ${worldName}
World description: ${worldDescription}

Current Vibe & Atmosphere:
"${currentVibe || '(not set)'}"

Current Writing Style:
"${currentWritingStyle || '(not set)'}"

User inspiration input:
"${rawText}"

Produce a vibe_append and writingStyle_append that extend the current fields based on this inspiration. Call submit_style_patch.`;
}
