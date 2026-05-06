export type PromptEngineerFieldType = 'inspiration' | 'vibe' | 'writing_style';

const FIELD_INSTRUCTIONS: Record<PromptEngineerFieldType, string> = {
  inspiration: `Describe this work as a creative influence for a fiction writer building a world. Cover:
- Themes and central conflicts
- Aesthetic and visual/sensory tone
- World-building style (how complex, how revealed)
- Character archetypes and narrative patterns
- What a writer would absorb from it as influence

Do NOT summarise plot. Focus on craft and atmosphere. ~200 words.`,

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

export function buildPromptEngineerUserMessage(
  fieldType: PromptEngineerFieldType,
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
