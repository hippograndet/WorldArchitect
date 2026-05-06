export interface WorldStyleConfig {
  preset?: string;
  vibe: string;
  writingStyle: string;
  inspirations: Array<{ name: string; expandedDescription: string }>;
  constraints?: string;
}

type PresetBase = Omit<WorldStyleConfig, 'inspirations'>;

export const WORLD_STYLE_PRESETS: Record<string, PresetBase> = {
  epic_fantasy: {
    preset: 'epic_fantasy',
    vibe: 'Grand, mythic, ancient. A world where the weight of history is felt in every stone and the stakes of every conflict echo across ages. Magic is real but costly. Heroes are forged by sacrifice.',
    writingStyle: 'Elevated, lyrical prose with long, deliberate sentences. Third-person distant to omniscient. Rich with proper nouns, lineage references, and in-world terminology. Avoids irony; takes itself seriously.',
  },
  gritty_realism: {
    preset: 'gritty_realism',
    vibe: 'Low-magic, brutal, political. Power is held by those willing to do what others won\'t. Moral ambiguity is the rule. Even heroic figures have blood on their hands. No clean victories.',
    writingStyle: 'Sparse, close third-person POV. Short sentences under pressure. Earthy vocabulary. Violence is visceral and carries consequences. Avoid purple prose; let action speak.',
  },
  cosmic_horror: {
    preset: 'cosmic_horror',
    vibe: 'Vast indifference, dread, and the creeping sense that human understanding is a thin veil over an incomprehensible reality. Knowledge is dangerous. Sanity is fragile. The cosmos is not hostile — it simply does not notice.',
    writingStyle: 'Slow-burn dread. Academic detachment giving way to growing unease. Unreliable narrators. Avoid explicit description of the horrors; imply and suggest. Lovecraftian but not racist.',
  },
  space_opera: {
    preset: 'space_opera',
    vibe: 'Interstellar scale, wonder, and conflict. Empires span star systems. Individual heroes shape galactic events. Technology is indistinguishable from magic. The universe is vast but feels alive and populated.',
    writingStyle: 'Cinematic and ensemble-driven. Fast pacing with chapter-length setpieces. Mix of action and political intrigue. Character voice is paramount. Think blockbuster science fiction.',
  },
  custom: {
    preset: 'custom',
    vibe: '',
    writingStyle: '',
  },
};
