export const VISUAL_ASSETS = Object.freeze({
  judge_penguin_v1: '/assets/characters/judge-penguin-v1.png',
  prosecutor_penguin_v1: '/assets/characters/prosecutor-penguin-v1.png',
  defense_penguin_v1: '/assets/characters/defense-penguin-v1.png',
  assistant_penguin_v1: '/assets/characters/assistant-penguin-v1.png',
  assistant_portrait_v1: '/assets/characters/assistant-portrait-v1.png',
  defense_portrait_v2: '/assets/characters/defense-portrait-v2.png',
  prosecutor_portrait_v2: '/assets/characters/prosecutor-portrait-v2.png',
  courtroom_v2: '/assets/backgrounds/courtroom-v2.png',
  investigation_v2: '/assets/backgrounds/investigation-v2.png',
  background_intro: '/assets/backgrounds/intro.svg',
  background_courtroom: '/assets/backgrounds/courtroom.svg',
  witness_neutral: '/assets/characters/witness-neutral.svg',
  defendant_neutral: '/assets/characters/defendant-neutral.svg',
  background_investigation: '/assets/backgrounds/investigation.svg',
  defense_neutral: '/assets/characters/defense-neutral.svg',
  defense_thinking: '/assets/characters/defense-thinking.svg',
  defense_confident: '/assets/characters/defense-confident.svg',
  prosecutor_neutral: '/assets/characters/prosecutor-neutral.svg',
  prosecutor_confident: '/assets/characters/prosecutor-confident.svg',
  prosecutor_surprised: '/assets/characters/prosecutor-surprised.svg',
  judge_neutral: '/assets/characters/judge-neutral.svg',
  effect_objection: '/assets/effects/objection.svg',
  network_a: '/assets/networks/network-a.svg',
  network_b: '/assets/networks/network-b.svg',
  network_c: '/assets/networks/network-c.svg',
  network_d: '/assets/networks/network-d.svg',
});

export function assetPath(assetId) {
  return VISUAL_ASSETS[assetId] ?? '';
}
