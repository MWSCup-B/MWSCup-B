import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildXssPrototype, createXssPrototypeGame, actXssPrototype,
  evaluateXssPrototype, xssPrototypePlayerView } from '../server/xss-prototype.js';
import { publicXssNetworks, xssTechnicalSelection } from '../server/xss-networks.js';
import { buildCandidates } from '../server/generation/candidate-builder.js';
import { loadCatalog } from '../server/generation/catalog.js';

const verified = { status: 'VERIFIED' };

function runtime(networkId = 'network-a', difficulty = 3) {
  return buildXssPrototype({ selection: xssTechnicalSelection(networkId, difficulty),
    verificationResult: verified });
}

function enterInvestigation(session, value) {
  actXssPrototype(session, value, { action: 'begin' });
  for (let index = 0; index < value.dialogue.initialCourt.length; index += 1) {
    actXssPrototype(session, value, { action: 'next-dialogue' });
  }
}

function solveInvestigation(session, value) {
  const round = value.evidenceChain[session.currentRound];
  const choice = round.choices.find(item => item.classification === 'CORRECT');
  actXssPrototype(session, value, { action: 'investigate', choiceId: choice.choiceId });
  actXssPrototype(session, value, { action: 'court' });
  return round;
}

test('XSS prototypeは固定Attack・Network A～D・Difficulty 1～3だけを受け付ける', () => {
  assert.deepEqual(publicXssNetworks().map(item => item.networkId),
    ['network-a', 'network-b', 'network-c', 'network-d']);
  for (const networkId of ['network-a', 'network-b', 'network-c', 'network-d']) {
    for (const difficulty of [1, 2, 3]) {
      const value = runtime(networkId, difficulty);
      assert.equal(value.attackType, 'reflected_xss');
      assert.equal(value.evidenceChain.length, difficulty);
      assert.equal(evaluateXssPrototype(value).status, 'ACCEPTED');
    }
  }
  assert.equal(xssTechnicalSelection('network-x', 1), null);
  assert.equal(xssTechnicalSelection('network-a', 4), null);
});

test('4固定Networkは既存XSS定義で到達可能なScenario Generation候補を作る', async () => {
  const definitions = await loadCatalog();
  for (const networkId of ['network-a', 'network-b', 'network-c', 'network-d']) {
    const input = xssTechnicalSelection(networkId, 2);
    const result = buildCandidates({ definitions, network: input.network,
      context: input.scenarioContext,
      selection: { schemaVersion: '1.0', selectedAttackIds: ['reflected_xss'] } });
    assert.equal(result.status, 'CREATED', `${networkId}: ${JSON.stringify(result.issues)}`);
  }
});

test('Network SVG 4種類とoriginal visual assetが存在しscriptを含まない', async () => {
  const paths = ['network-a', 'network-b', 'network-c', 'network-d'].map(name =>
    new URL(`../public/assets/networks/${name}.svg`, import.meta.url));
  for (const path of paths) {
    const source = await readFile(path, 'utf8');
    assert.match(source, /<svg/); assert.match(source, /Internet/);
    assert.doesNotMatch(source, /<script|javascript:/i);
  }
  for (const path of ['backgrounds/intro.svg', 'backgrounds/courtroom.svg',
    'backgrounds/investigation.svg', 'characters/defense-confident.svg',
    'effects/objection.svg']) assert.match(await readFile(
      new URL(`../public/assets/${path}`, import.meta.url), 'utf8'), /<svg/);
});

test('Author通常画面はXSS・Network Card・Difficulty・生成ボタンだけを入力にする', async () => {
  const html = await readFile(new URL('../public/author.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../public/author.js', import.meta.url), 'utf8');
  assert.match(html, /XSS/); assert.match(html, /network-list/); assert.match(html, /difficulty-list/);
  assert.match(html, /ゲームを生成/); assert.doesNotMatch(html, /textarea|Developer Mode|Import/);
  assert.match(script, /networkId/); assert.match(script, /difficulty/);
});

test('Introは事件・疑われた理由・罪状だけを公開しGround Truthを漏らさない', () => {
  const value = runtime('network-a', 1); const session = createXssPrototypeGame(value);
  const view = xssPrototypePlayerView(session, value); const serialized = JSON.stringify(view);
  assert.equal(view.currentScene, 'INTRO');
  assert.deepEqual(Object.keys(view.publicSummary).sort(), ['charge', 'incident', 'suspicion']);
  assert.doesNotMatch(serialized,
    /groundTruth|correctEvidenceIds|classification|verificationStatus|technicalCounterArgument/);
});

test('Court DialogueはJUDGE・PROSECUTOR・DEFENSEの固定Templateを順に表示する', () => {
  const value = runtime('network-a', 1); const session = createXssPrototypeGame(value);
  actXssPrototype(session, value, { action: 'begin' });
  const speakers = [];
  for (let index = 0; index < value.dialogue.initialCourt.length; index += 1) {
    speakers.push(xssPrototypePlayerView(session, value).dialogue.speaker);
    actXssPrototype(session, value, { action: 'next-dialogue' });
  }
  assert.deepEqual(new Set(speakers), new Set(['PROSECUTOR', 'DEFENSE', 'JUDGE']));
  assert.equal(session.currentScene, 'INVESTIGATION');
});

test('InvestigationはSynthetic Logと4択を表示しwrong choiceでEvidenceを与えない', () => {
  const value = runtime('network-d', 1); const session = createXssPrototypeGame(value);
  enterInvestigation(session, value);
  let view = xssPrototypePlayerView(session, value);
  assert.equal(view.syntheticLog.length, 6); assert.equal(view.choices.length, 4);
  assert.doesNotMatch(JSON.stringify(view.choices), /classification|CORRECT/);
  const wrong = value.evidenceChain[0].choices.find(item => item.classification === 'IRRELEVANT');
  view = actXssPrototype(session, value, { action: 'investigate', choiceId: wrong.choiceId });
  assert.equal(view.investigationResult.success, false); assert.equal(view.acquiredEvidence.length, 0);
});

test('correct investigationでEvidenceを取得しCourt Roundへ進む', () => {
  const value = runtime('network-b', 1); const session = createXssPrototypeGame(value);
  enterInvestigation(session, value); const evidence = solveInvestigation(session, value);
  const view = xssPrototypePlayerView(session, value);
  assert.equal(view.currentScene, 'COURT_EVIDENCE_ROUND');
  assert.deepEqual(view.presentableEvidence.map(item => item.evidenceId), [evidence.evidenceId]);
});

test('wrong Evidenceは異議を表示せず同じRoundのInvestigationへ戻す', () => {
  const value = runtime('network-c', 2); const session = createXssPrototypeGame(value);
  enterInvestigation(session, value);
  const first = solveInvestigation(session, value);
  actXssPrototype(session, value, { action: 'present-evidence', evidenceId: first.evidenceId });
  actXssPrototype(session, value, { action: 'next-round' });
  const second = solveInvestigation(session, value);
  const view = actXssPrototype(session, value,
    { action: 'present-evidence', evidenceId: first.evidenceId });
  assert.notEqual(first.evidenceId, second.evidenceId);
  assert.equal(view.currentScene, 'INVESTIGATION');
  assert.equal(JSON.stringify(view).includes('異議あり'), false);
  assert.equal(view.currentRound, 2);
});

test('正解Evidenceだけが異議ありを表示しmulti-round後にACQUITTEDへ到達する', () => {
  const value = runtime('network-d', 3); const session = createXssPrototypeGame(value);
  enterInvestigation(session, value);
  for (let index = 0; index < 3; index += 1) {
    const evidence = solveInvestigation(session, value);
    const view = actXssPrototype(session, value,
      { action: 'present-evidence', evidenceId: evidence.evidenceId });
    if (index < 2) {
      assert.equal(view.courtResult.objection, true);
      assert.match(view.courtResult.defenseDialogue.join(' '), /異議あり/);
      actXssPrototype(session, value, { action: 'next-round' });
    } else {
      assert.equal(view.courtResult.objection, true);
      assert.match(view.courtResult.defenseDialogue.join(' '), /異議あり/);
      const final = actXssPrototype(session, value, { action: 'finish' });
      assert.equal(final.currentScene, 'ACQUITTED');
      assert.equal(final.outcome, 'ACQUITTED'); assert.equal(final.gameClear, 'GAME CLEAR');
    }
  }
});

test('XSS調査実装はshell・filesystem・network accessを呼び出さない', async () => {
  const source = await readFile(new URL('../server/xss-prototype.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /node:child_process|exec\(|spawn\(|node:fs|node:http|node:https/);
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function/);
});
