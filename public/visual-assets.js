export const VISUAL_ASSETS = Object.freeze({
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
