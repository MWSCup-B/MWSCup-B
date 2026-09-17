import { GameError } from './game.js';
import { XSS_NETWORKS } from './xss-networks.js';
import { validateDocument } from './generation/schema.js';

const CHARACTER_ASSETS = Object.freeze({
  defense: { neutral: 'defense_neutral', thinking: 'defense_thinking', confident: 'defense_confident' },
  prosecutor: { neutral: 'prosecutor_neutral', confident: 'prosecutor_confident', surprised: 'prosecutor_surprised' },
  judge: { neutral: 'judge_neutral' },
});

const BACKGROUND_ASSETS = Object.freeze({ intro: 'background_intro', courtroom: 'background_courtroom',
  investigation: 'background_investigation' });

const CASE_VARIABLES = Object.freeze({
  'network-a': { charge: '業務Webサイトへの不正なスクリプト入力', incidentTime: '20時42分',
    targetSystem: 'Web01', prosecutionEvidence: 'Client01に対応するアクセス記録',
    prosecutionClaim: '被告人の利用端末から問題のリクエストが送られた',
    counter: ['アクセス記録は入力の到達を示しますが、実際の操作者までは示しません。',
      'プロキシ記録はリクエストの流入経路が別に存在したことを示します。',
      'アプリケーション記録は反射処理の成立と端末利用者の同一性が別問題であることを示します。'] },
  'network-b': { charge: '社内Webサイトを利用した反射型XSS', incidentTime: '14時18分',
    targetSystem: 'Web01', prosecutionEvidence: 'EmployeePC01の送信元記録',
    prosecutionClaim: 'EmployeePC01の利用者が攻撃入力を作成した',
    counter: ['Web記録だけでは、入力を作成した人物とブラウザ利用者を同一視できません。',
      'Proxy記録は外部誘導を経由したリクエストであることを示します。',
      'Browser記録は利用者が細工されたリンクを開いた経緯を示します。'] },
  'network-c': { charge: '公開フロントエンドへの反射型XSS', incidentTime: '09時07分',
    targetSystem: 'Frontend01', prosecutionEvidence: 'AdminPC01に関連付いたアクセス',
    prosecutionClaim: '管理端末の利用者がXSSを実行した',
    counter: ['Frontend記録は反射入力を示しますが、作成者の本人性は示しません。',
      'WAF記録はエンコードされた入力が外部経路から到達したことを示します。',
      'Browser記録は管理端末が誘導先を表示した時系列を示します。'] },
  'network-d': { charge: 'DMZ Webサービスへの反射型XSS', incidentTime: '22時31分',
    targetSystem: 'DMZWeb01', prosecutionEvidence: 'Client01と結び付けられたWeb記録',
    prosecutionClaim: '被告人がClient01から攻撃した',
    counter: ['DMZ Web記録だけでは入力の作成者を断定できません。',
      'Proxy記録は外部から渡されたURLが中継された経路を示します。',
      'Central Logの時系列は端末の利用と入力作成が同一ではないことを示します。'] },
});

const LOG_LINES = Object.freeze([
  '10:01:04 GET /assets/site.css 200',
  '10:01:12 GET /search?q=quarterly+report 200',
  '10:02:26 GET /search?q=%3Cscript%3Ereview()%3C%2Fscript%3E 200',
  '10:02:27 GET /redirect?next=%2Fsearch%3Fq%3D%25253Cscript 302',
  '10:02:29 BROWSER navigation source=external-link target=/search',
  '10:03:10 GET /missing-icon.svg 404',
]);

function choices(round) {
  const suffix = round + 1;
  return [
    { choiceId: `choice_${suffix}_encoded`, label: 'grep "%3Cscript" access.log', classification: 'CORRECT' },
    { choiceId: `choice_${suffix}_post`, label: 'grep "POST" access.log', classification: 'PLAUSIBLE' },
    { choiceId: `choice_${suffix}_404`, label: 'grep "404" access.log', classification: 'IRRELEVANT' },
    { choiceId: `choice_${suffix}_agent`, label: 'grep "User-Agent" access.log', classification: 'MISLEADING' },
  ];
}

function initialDialogue(variables) {
  return [
    { speaker: 'PROSECUTOR', expression: 'confident', text: `${variables.incidentTime}、${variables.targetSystem}で${variables.charge}が確認されました。` },
    { speaker: 'PROSECUTOR', expression: 'confident', text: `${variables.prosecutionEvidence}があります。検察は、${variables.prosecutionClaim}と主張します。` },
    { speaker: 'DEFENSE', expression: 'thinking', text: 'この情報だけでは、事件の全体像を判断できません。技術記録と実際の操作者は区別して検討すべきです。' },
    { speaker: 'JUDGE', expression: 'neutral', text: '追加の技術調査を認めます。検証可能な記録を確認してください。' },
  ];
}

function publicEvidence(item) {
  return { evidenceId: item.evidenceId, title: item.title, publicContent: item.publicContent,
    sourceName: item.sourceName };
}

export function buildXssPrototype({ selection, verificationResult }) {
  if (!selection || selection.attackType !== 'reflected_xss') throw new GameError(
    'XSS_SELECTION_REQUIRED', 'selection.attackType', 'XSSプロトタイプはreflected_xssのみ利用できます。');
  if (verificationResult?.status !== 'VERIFIED') throw new GameError(
    'SCENARIO_NOT_VERIFIED', 'verificationResult.status', 'VERIFIEDなScenarioだけをゲーム化できます。', 409);
  const network = XSS_NETWORKS.find(item => item.networkId === selection.selectedNetworkId);
  if (!network || !Number.isInteger(selection.difficulty) || selection.difficulty < 1
    || selection.difficulty > 3) throw new GameError('INVALID_XSS_SELECTION', 'selection',
    '固定Network A～Dと難易度1～3を選択してください。');
  const variables = CASE_VARIABLES[network.networkId];
  validateDocument('xss-prototype-selection', { schemaVersion: '1.0',
    attackType: selection.attackType, selectedNetworkId: selection.selectedNetworkId,
    difficulty: selection.difficulty, requiredEvidenceCount: selection.requiredEvidenceCount });
  const evidenceChain = network.investigation.slice(0, selection.difficulty).map(([nodeId, sourceName], index) => ({
    evidenceId: `xss_evidence_${index + 1}`, round: index + 1, nodeId, sourceName,
    title: `${sourceName}の調査記録`,
    publicContent: index === 0
      ? 'エンコードされたスクリプト入力を含む検索リクエストが記録されています。'
      : index === 1
        ? '同じリクエスト系列が外部経路から中継された時刻情報が記録されています。'
        : 'ブラウザ側または集約ログの時系列に、外部リンクからの遷移が記録されています。',
    technicalCounterArgument: variables.counter[index], choices: choices(index),
    syntheticLog: LOG_LINES.map((line, lineIndex) => `${String(lineIndex + 1).padStart(2, '0')} ${line}`),
  }));
  return { mode: 'XSS_PROTOTYPE', schemaVersion: '1.0', attackType: 'reflected_xss',
    selectedNetworkId: network.networkId, difficulty: selection.difficulty,
    requiredEvidenceCount: selection.difficulty,
    network: structuredClone(network), variables: structuredClone(variables), evidenceChain,
    dialogue: { initialCourt: initialDialogue(variables) },
    assets: { characters: CHARACTER_ASSETS, backgrounds: BACKGROUND_ASSETS,
      effect: { objection: 'effect_objection' } },
    internal: { verificationStatus: verificationResult.status,
      simulationOnly: true, correctEvidenceIds: evidenceChain.map(item => item.evidenceId) },
  };
}

export function createXssPrototypeGame(runtime) {
  if (runtime?.mode !== 'XSS_PROTOTYPE') throw new GameError('GAME_BUILD_BLOCKED', 'game',
    'XSSプロトタイプを開始できません。', 503);
  return { currentScene: 'INTRO', dialogueIndex: 0, currentRound: 0,
    acquiredEvidenceIds: [], investigationResult: null, courtResult: null };
}

function requireScene(session, scene) {
  if (session.currentScene !== scene) throw new GameError('INVALID_SCENE', 'action',
    '現在のSceneでは実行できない操作です。', 409);
}

function publicNetwork(network) {
  const { networkId, code, displayName, diagramAssetId, diagramPath, subnets, nodes,
    connections, logSources } = network;
  return structuredClone({ networkId, code, displayName, diagramAssetId, diagramPath,
    subnets, nodes, connections, logSources });
}

export function xssPrototypePlayerView(session, runtime) {
  const round = runtime.evidenceChain[session.currentRound] ?? runtime.evidenceChain.at(-1);
  const base = { mode: 'XSS_PROTOTYPE', schemaVersion: '1.0', currentScene: session.currentScene,
    attackLabel: 'Cross-Site Scripting', difficulty: runtime.difficulty,
    requiredEvidenceCount: runtime.requiredEvidenceCount, currentRound: session.currentRound + 1,
    network: publicNetwork(runtime.network),
    assets: structuredClone(runtime.assets),
    acquiredEvidence: runtime.evidenceChain.filter(item => session.acquiredEvidenceIds.includes(item.evidenceId))
      .map(publicEvidence) };
  if (session.currentScene === 'INTRO') return { ...base,
    backgroundAssetId: 'background_intro', publicSummary: {
      incident: `${runtime.variables.targetSystem}でWebセキュリティインシデントが発生しました。`,
      suspicion: runtime.variables.prosecutionEvidence,
      charge: runtime.variables.charge,
    } };
  if (session.currentScene === 'INITIAL_COURT') return { ...base,
    backgroundAssetId: 'background_courtroom', dialogue:
      structuredClone(runtime.dialogue.initialCourt[session.dialogueIndex]),
    hasNextDialogue: session.dialogueIndex < runtime.dialogue.initialCourt.length - 1 };
  if (session.currentScene === 'INVESTIGATION') return { ...base,
    backgroundAssetId: 'background_investigation', highlightedNodeId: round.nodeId,
    investigationTarget: { nodeId: round.nodeId,
      displayName: runtime.network.nodes.find(node => node.id === round.nodeId)?.displayName,
      sourceName: round.sourceName },
    syntheticLog: [...round.syntheticLog],
    choices: round.choices.map(({ choiceId, label }) => ({ choiceId, label })),
    investigationResult: structuredClone(session.investigationResult),
    canReturnToCourt: session.acquiredEvidenceIds.includes(round.evidenceId) };
  if (session.currentScene === 'COURT_EVIDENCE_ROUND') return { ...base,
    backgroundAssetId: 'background_courtroom', prosecutionDialogue:
      '依然として被告人の関与が示されています。取得した証拠で、この主張を検討してください。',
    presentableEvidence: base.acquiredEvidence,
    courtResult: structuredClone(session.courtResult) };
  if (session.currentScene === 'ACQUITTED') return { ...base,
    backgroundAssetId: 'background_courtroom', judgeDialogue:
      '提出された証拠を総合すると、被告人の関与を断定することはできません。',
    outcome: 'ACQUITTED', gameClear: 'GAME CLEAR' };
  throw new GameError('INVALID_SCENE', 'scene', '公開できないSceneです。', 500);
}

export function actXssPrototype(session, runtime, { action, choiceId, evidenceId }) {
  const round = runtime.evidenceChain[session.currentRound];
  if (action === 'begin') {
    requireScene(session, 'INTRO'); session.currentScene = 'INITIAL_COURT';
  } else if (action === 'next-dialogue') {
    requireScene(session, 'INITIAL_COURT');
    if (session.dialogueIndex < runtime.dialogue.initialCourt.length - 1) session.dialogueIndex += 1;
    else session.currentScene = 'INVESTIGATION';
  } else if (action === 'investigate') {
    requireScene(session, 'INVESTIGATION');
    const selected = round.choices.find(item => item.choiceId === choiceId);
    if (!selected) throw new GameError('UNKNOWN_INVESTIGATION_CHOICE', 'choiceId',
      '表示された調査方法を選択してください。');
    if (selected.classification === 'CORRECT') {
      if (!session.acquiredEvidenceIds.includes(round.evidenceId)) {
        session.acquiredEvidenceIds.push(round.evidenceId);
      }
      session.investigationResult = { success: true,
        publicMessage: '関連する記録が見つかり、証拠として取得しました。',
        acquiredEvidence: publicEvidence(round) };
    } else session.investigationResult = { success: false,
      publicMessage: 'その条件では、現在の主張を検証できる記録は特定できませんでした。' };
  } else if (action === 'court') {
    requireScene(session, 'INVESTIGATION');
    if (!session.acquiredEvidenceIds.includes(round.evidenceId)) throw new GameError(
      'ROUND_EVIDENCE_REQUIRED', 'evidence', '現在RoundのEvidenceを取得してください。', 409);
    session.currentScene = 'COURT_EVIDENCE_ROUND'; session.courtResult = null;
  } else if (action === 'present-evidence') {
    requireScene(session, 'COURT_EVIDENCE_ROUND');
    if (!session.acquiredEvidenceIds.includes(evidenceId)) throw new GameError(
      'EVIDENCE_NOT_OWNED', 'evidenceId', '取得済みEvidenceだけを提示できます。');
    if (evidenceId !== round.evidenceId) {
      session.courtResult = null; session.currentScene = 'INVESTIGATION';
      session.investigationResult = { success: false, courtRetry: true,
        publicMessage: 'その証拠では、この主張を覆すことはできません。追加調査を行ってください。' };
    } else {
      const finalRound = session.currentRound === runtime.evidenceChain.length - 1;
      session.courtResult = { success: true, objection: true, effectAssetId: 'effect_objection',
        defenseDialogue: ['異議あり！！', 'その主張には問題があります。',
          'こちらの証拠をご覧ください。', round.title,
          `この証拠から、${round.technicalCounterArgument}`],
        prosecutorDialogue: finalRound ? '提出された技術記録を確認します。'
          : 'その点については認めましょう。しかし、まだ説明されていない点があります。',
        hasNextRound: !finalRound, finishAvailable: finalRound };
    }
  } else if (action === 'next-round') {
    requireScene(session, 'COURT_EVIDENCE_ROUND');
    if (!session.courtResult?.success || !session.courtResult.hasNextRound) throw new GameError(
      'ROUND_NOT_CLEARED', 'action', '現在Roundを正しいEvidenceで完了してください。', 409);
    session.currentRound += 1; session.currentScene = 'INVESTIGATION';
    session.investigationResult = null; session.courtResult = null;
  } else if (action === 'finish') {
    requireScene(session, 'COURT_EVIDENCE_ROUND');
    if (!session.courtResult?.success || !session.courtResult.finishAvailable) throw new GameError(
      'FINAL_ROUND_NOT_CLEARED', 'action', '最終Roundを正しいEvidenceで完了してください。', 409);
    session.currentScene = 'ACQUITTED';
  } else throw new GameError('UNKNOWN_ACTION', 'action', '未登録の操作です。');
  return xssPrototypePlayerView(session, runtime);
}

export function evaluateXssPrototype(runtime) {
  const issues = [];
  if (runtime.attackType !== 'reflected_xss') issues.push('ATTACK_NOT_XSS');
  if (runtime.evidenceChain.length !== runtime.difficulty) issues.push('DIFFICULTY_EVIDENCE_MISMATCH');
  if (!runtime.evidenceChain.every((item, index) => item.round === index + 1
    && runtime.network.nodes.some(node => node.id === item.nodeId)
    && item.choices.filter(choice => choice.classification === 'CORRECT').length === 1)) {
    issues.push('EVIDENCE_CHAIN_INVALID');
  }
  const session = createXssPrototypeGame(runtime); const publicViews = [];
  publicViews.push(xssPrototypePlayerView(session, runtime));
  actXssPrototype(session, runtime, { action: 'begin' });
  publicViews.push(xssPrototypePlayerView(session, runtime));
  for (let index = 0; index < runtime.dialogue.initialCourt.length; index += 1) {
    actXssPrototype(session, runtime, { action: 'next-dialogue' });
  }
  for (let index = 0; index < runtime.evidenceChain.length; index += 1) {
    const item = runtime.evidenceChain[index];
    const correct = item.choices.find(choice => choice.classification === 'CORRECT');
    actXssPrototype(session, runtime, { action: 'investigate', choiceId: correct.choiceId });
    publicViews.push(xssPrototypePlayerView(session, runtime));
    actXssPrototype(session, runtime, { action: 'court' });
    publicViews.push(xssPrototypePlayerView(session, runtime));
    actXssPrototype(session, runtime, { action: 'present-evidence', evidenceId: item.evidenceId });
    publicViews.push(xssPrototypePlayerView(session, runtime));
    if (index < runtime.evidenceChain.length - 1) {
      actXssPrototype(session, runtime, { action: 'next-round' });
    } else actXssPrototype(session, runtime, { action: 'finish' });
  }
  if (session.currentScene !== 'ACQUITTED') issues.push('NORMAL_ROUTE_UNREACHABLE');
  if (runtime.difficulty > 1) {
    const retry = createXssPrototypeGame(runtime); actXssPrototype(retry, runtime, { action: 'begin' });
    for (let index = 0; index < runtime.dialogue.initialCourt.length; index += 1) {
      actXssPrototype(retry, runtime, { action: 'next-dialogue' });
    }
    for (let index = 0; index < 2; index += 1) {
      const item = runtime.evidenceChain[index];
      const correct = item.choices.find(choice => choice.classification === 'CORRECT');
      actXssPrototype(retry, runtime, { action: 'investigate', choiceId: correct.choiceId });
      actXssPrototype(retry, runtime, { action: 'court' });
      if (index === 0) {
        actXssPrototype(retry, runtime, { action: 'present-evidence', evidenceId: item.evidenceId });
        actXssPrototype(retry, runtime, { action: 'next-round' });
      }
    }
    const wrongView = actXssPrototype(retry, runtime, { action: 'present-evidence',
      evidenceId: runtime.evidenceChain[0].evidenceId });
    if (wrongView.currentScene !== 'INVESTIGATION' || JSON.stringify(wrongView).includes('異議あり')) {
      issues.push('WRONG_EVIDENCE_RETRY_INVALID');
    }
  }
  const publicProbe = JSON.stringify(publicViews);
  for (const forbidden of ['correctEvidenceIds', 'verificationStatus', 'classification', 'groundTruth']) {
    if (publicProbe.includes(forbidden)) issues.push(`PUBLIC_LEAK_${forbidden}`);
  }
  return validateDocument('xss-prototype-evaluation', { schemaVersion: '1.0',
    status: issues.length ? 'REJECTED' : 'ACCEPTED', issues,
    checks: { xssValid: runtime.attackType === 'reflected_xss', networkValid: true,
      difficultyMatchesEvidence: runtime.evidenceChain.length === runtime.difficulty,
      evidenceChainReachable: !issues.includes('EVIDENCE_CHAIN_INVALID'),
      publicBoundarySafe: !issues.some(item => item.startsWith('PUBLIC_LEAK_')) } });
}
