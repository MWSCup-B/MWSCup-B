// Fixed application soundtrack; never part of generated scenario data or LLM input.
export const AUDIO_CATALOG = {
  'secret-corridor': { title: 'Secret Corridor', artist: 'PeriTune / むつき醒',
    source: 'https://peritune.com/blog/2026/09/18/secret_corridor/', license: 'https://peritune.com/about/' },
  'ticking-labyrinth': { title: 'Ticking Labyrinth', artist: 'PeriTune / むつき醒',
    source: 'https://peritune.com/blog/2026/06/11/ticking-labyrinth/', license: 'https://peritune.com/about/' },
  insight: { title: 'Insight', artist: 'Sakuttipanda', source: 'https://opentracks.com/bgm/detail/23690', license: 'https://opentracks.com/help/articles/license/' },
  garden: { title: 'プラネタリウムガーデン', artist: 'まんぼう二等兵', source: 'https://opentracks.com/bgm/detail/12920', license: 'https://opentracks.com/help/articles/license/' },
  crisis: { title: '危機', artist: '田中芳典', source: 'https://opentracks.com/bgm/detail/12891', license: 'https://opentracks.com/help/articles/license/' },
  truth: { title: '真実の証明', artist: 'カピバラっ子', source: 'https://opentracks.com/bgm/detail/19527', license: 'https://opentracks.com/help/articles/license/' },
  ...Object.fromEntries([
    ['confirm', '決定ボタンを押す2'], ['save', '決定ボタンを押す7'], ['start', '決定ボタンを押す12'],
    ['cursor', 'カーソル移動2'], ['message', 'メッセージ表示音3'], ['success', '成功音'],
  ].map(([id, title]) => [id, { title, artist: '効果音ラボ',
    source: 'https://soundeffect-lab.info/sound/button/', license: 'https://soundeffect-lab.info/agreement/' }])),
};

export const AUDIO_SCENES = {
  title: { tracks: ['insight', 'secret-corridor'], level: 0.65 },
  generation: { tracks: ['garden', 'secret-corridor'], level: 0.38 },
  investigation: { tracks: ['secret-corridor'], level: 0.65 },
  court: { tracks: ['crisis', 'ticking-labyrinth'], level: 0.6 },
  explanation: { tracks: ['truth', 'secret-corridor'], level: 0.48 },
  silent: { tracks: [], level: 0 },
};

export function sceneForGame(game) {
  const state = game?.currentState ?? game?.currentScene ?? game?.phase;
  if (['INVESTIGATION', 'detective', 'GUILTY_RETRY'].includes(state)) return 'investigation';
  if (['INITIAL_COURT', 'RETRIAL_COURT', 'COURT_EVIDENCE_ROUND', 'courtroom'].includes(state)) return 'court';
  if (['ACQUITTED', 'result'].includes(state)) return 'explanation';
  if (state === 'BLOCKED') return 'silent';
  return 'title';
}
