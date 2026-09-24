// Scenarioの参照構造はAIに自由生成させず、検証済みConfigurationからBackendで組み立てる。
// AIは独立レビューと、指摘された記述・既存artifactへの不足参照の修正を担当する。
import { buildEvidenceInvestigationPlan } from './investigation-registry.js';
import { fail } from './schema.js';
import { requestedCourtIssueCount } from './court-issues.js';
import { isDeepStrictEqual } from 'node:util';

// 2026-09-20 修正後: 記述の自由度と技術的な参照構造を分離する。
export function validateScenarioDesignBoundary(template, proposed) {
  const structure = value => {
    const copy = structuredClone(value);
    for (const character of copy.characters?.characters ?? []) delete character.displayName;
    for (const objective of copy.learningObjectives?.objectives ?? []) delete objective.description;
    for (const requirement of copy.evidenceRequirements?.requirements ?? []) delete requirement.description;
    return copy;
  };
  if (!isDeepStrictEqual(structure(template), structure(proposed))) {
    fail('SCENARIO_DESIGN_BOUNDARY_CHANGED', 'scenario-import-package',
      '変更できるのは人物名と学習目標・証拠要件のdescriptionだけです。技術構造と全参照を維持してください。');
  }
}

export function buildScenarioTemplate({ generationInput, configuration }) {
  const graph = generationInput.technicalInput.attackGraph;
  const attackGraphRef = { ...generationInput.attackGraphRef };
  const suffix = configuration.configurationId.replace(/^configuration_/, '').slice(0, 40);
  const scenarioId = `scenario_${suffix}`;
  const characters = {
    schemaVersion: '1.0', characterSetId: `characters_${suffix}`, scenarioId, attackGraphRef,
    characters: [
      { characterId: 'character_defendant', displayName: `架空の${configuration.incidentContext.accusedRole}`,
        provenance: 'AI_GENERATED_SYNTHETIC', roles: ['defendant'], bindingRefs: [] },
      { characterId: 'character_attacker', displayName: '架空の攻撃者',
        provenance: 'AI_GENERATED_SYNTHETIC', roles: ['attacker'], bindingRefs: [] },
      { characterId: 'character_witness', displayName: '架空の調査担当者',
        provenance: 'AI_GENERATED_SYNTHETIC', roles: ['witness'], bindingRefs: [] },
    ],
  };
  const technicalFacts = [
    ...graph.nodes.map(node => ({ factId: `fact_${node.nodeId}`, sourceType: 'ATTACK_NODE',
      attackNodeId: node.nodeId, sourceId: node.nodeId })),
    ...graph.edges.map(edge => ({ factId: `fact_${edge.edgeId}`, sourceType: 'ATTACK_EDGE',
      attackNodeId: null, sourceId: edge.edgeId })),
  ];
  const groundTruth = {
    schemaVersion: '1.0', groundTruthId: `ground_truth_${suffix}`, scenarioId, attackGraphRef,
    technicalFacts, characterFactRefs: characters.characters.map(character => ({
      characterId: character.characterId, role: character.roles[0],
    })),
  };

  const predecessors = new Map(graph.nodes.map(node => [node.nodeId, new Set()]));
  for (const relation of [...graph.edges.map(edge => ({ before: edge.from, after: edge.to })),
    ...graph.executionConstraints]) predecessors.get(relation.after)?.add(relation.before);
  const ranks = new Map();
  const rank = nodeId => {
    if (!ranks.has(nodeId)) ranks.set(nodeId, predecessors.get(nodeId)?.size
      ? Math.max(...[...predecessors.get(nodeId)].map(previous => rank(previous) + 1)) : 0);
    return ranks.get(nodeId);
  };
  const events = graph.nodes.map(node => ({ eventId: `event_${node.nodeId}`,
    order: rank(node.nodeId), attackNodeId: node.nodeId,
    dependsOn: [...(predecessors.get(node.nodeId) ?? [])].map(id => `event_${id}`).sort() }));
  const attacksById = new Map(configuration.attacks.map(attack => [attack.attackId, attack]));
  const timeline = { schemaVersion: '1.0', timelineId: `timeline_${suffix}`, scenarioId,
    attackGraphRef, events, narrativeTimestamps: graph.nodes.flatMap(node => {
      const attack = attacksById.get(node.attackDefinitionId);
      return attack ? [{ eventId: `event_${node.nodeId}`, displayTimestamp: attack.occurrenceTime }] : [];
    }) };

  const firstNode = graph.nodes[0];
  const firstDefinition = generationInput.technicalInput.attackDefinitions
    .find(item => item.id === firstNode.attackDefinitionId);
  const learningObjectives = {
    schemaVersion: '1.0', learningObjectiveSetId: `objectives_${suffix}`, scenarioId,
    attackGraphRef, objectives: [{ objectiveId: 'objective_trace',
      description: '選択した調査資料を攻撃経路と時系列へ結び付け、記録だけで人物を断定できないことを説明する。',
      origin: 'DERIVED_FROM_TECHNICAL_INPUT',
      selectedAttackIds: [...graph.selectedAttackIds], attackNodeIds: graph.nodes.map(node => node.nodeId),
      definitionReferenceRefs: firstNode.referenceIds.slice(0, 1).map(referenceId => ({
        attackDefinitionId: firstDefinition.id, referenceId,
      })) }],
  };
  const investigationPlan = buildEvidenceInvestigationPlan(configuration, generationInput);
  if (investigationPlan.length < 2) fail('INSUFFICIENT_OBSERVABLE_EVIDENCE',
    'evidenceRequirements.requirements', '複数資料による論証に必要な取得可能資料が不足しています。');
  const artifactGrounds = investigationPlan.map(item => item.ground);
  const factGrounds = technicalFacts.map(fact => ({ sourceType: 'GROUND_TRUTH_FACT',
    sourceId: fact.factId, attackNodeId: null }));
  const characterGrounds = ['character_defendant', 'character_witness'].map(sourceId => ({
    sourceType: 'CHARACTER', sourceId, attackNodeId: null }));
// 2026-09-20 修正前: 先頭攻撃だけでなく全攻撃の調査目的をScenarioに保持する
//   const firstAttack = [...configuration.attacks].sort((a, b) => a.order - b.order)[0];
// 2026-09-20 修正後: 先頭攻撃だけでなく全攻撃の調査目的をScenarioに保持する
  const investigationIntents = [...configuration.attacks].sort((a, b) => a.order - b.order)
    .map(attack => attack.attackId + ' / 主調査 ' + attack.investigationTypes.join('・')
      + ': ' + (configuration.attacks.length === 1 ? attack.evidenceAnswer
        : '答えの全文はこの攻撃の個別取得要件で照合する')).join(' / ');
  const hasEmailAndWeb = investigationPlan.some(item => item.ground.sourceId === 'email_record')
    && investigationPlan.some(item => item.ground.sourceId === 'web_access_record');
  const comparison = hasEmailAndWeb
    ? '保存メールの表示URLとHTMLソースのhrefを区別して提示し、hrefとWebアクセス記録の対象リクエストを照合する。各資料に記録された時刻・対象・その記録範囲を比較する。表示URLとhrefの相違を扱う場合は、既存の欺瞞的メールの合成本文として比較可能にし、新しい接続先やHTTPリダイレクトを技術事実として追加しない。メール保存はクリックの証明ではなく、アクセス記録もクリック原因・操作人物・意図を示さない。'
// 2026-09-20 修正前: Web以外の攻撃にも資料の証明範囲を適用
//     : '各資料の対象リクエストと記録時刻・記録範囲を照合する。アクセス記録だけでスクリプト実行やSQL実行を証明せず、それぞれ確認済みの実行計測・DB記録と区別する。';
// 2026-09-20 修正後: Web以外の攻撃にも資料の証明範囲を適用
    : '各資料が記録する対象・操作・時刻・実効主体と証明できる範囲を照合する。アクセスや設定の存在だけで実行成功を証明せず、対象攻撃で定義された実行計測・処理記録と区別する。ローカル攻撃にWebリクエストやDB操作を追加しない。';
  const allegation = hasEmailAndWeb
    ? 'メールの誘導先とWebアクセスの対象が一致するので、この二つの記録だけで被告人が自分の意思でリクエストを送ったと特定できる。'
    : 'これらの技術記録だけで被告人が自分の意思で対象の操作を行ったと特定できる。';
  const issueDesign = ` ${requestedCourtIssueCount(configuration)}件の異なる争点を設計する。`
    + '上記主張の前提となる記録の解釈と、人物・意図への推論を分離し、各争点を独立した架空の証言statementとして明示する。'
    + (hasEmailAndWeb ? '先に表示URLとリンク要素hrefの同一視を記録の原文で検討し、最後に人物を特定できるという主張を複数資料で検討する。'
// 2026-09-20 修正前: ローカル攻撃に存在しないリクエストを前提にしない
//       : '先にリクエストの記録を処理結果の記録と同一視する主張を資料の記録範囲から検討し、最後に人物を特定できるという主張を複数資料で検討する。')
// 2026-09-20 修正後: ローカル攻撃に存在しないリクエストを前提にしない
      : '先に操作の記録や設定の存在だけから成功・権限取得を断定する主張を資料の記録範囲から検討し、最後に人物を特定できるという主張を複数資料で検討する。')
    + '追加の争点が必要な場合は時系列から因果を断定する主張、記録から意図を断定する主張を、それぞれ取得資料の証明限界と対応付ける。同じ文の言い換えで水増ししない。'
    + 'これらは証言者の架空の主張であり、技術的事実の追加ではない。既存資料から反駁できない論点は生成せず、独立レビューへ不足を報告する。';
  const evidenceRequirements = {
    schemaVersion: '1.0', evidenceRequirementSetId: `requirements_${suffix}`, scenarioId,
    attackGraphRef, requirements: [
      { requirementId: 'requirement_attack', purpose: 'ATTACK_TRACE',
// 2026-09-20 修正前: 全攻撃の調査目的をEvidence生成へ渡す
//         description: `制作者の主調査 ${firstAttack.investigationTypes.join('・')}: ${firstAttack.evidenceAnswer} `
// 2026-09-20 修正後: 全攻撃の調査目的をEvidence生成へ渡す
        description: `制作者の調査目的: ${investigationIntents} `
          + comparison + ` 難易度${configuration.difficulty}・evidenceCount=${configuration.evidenceCount}は調査チェーンの基準で、法廷は${requestedCourtIssueCount(configuration)}争点。取得資料総数の上限ではない。補助資料も個別の取得要件に従い通常プレイで取得する。`,
        grounds: structuredClone(artifactGrounds), learningObjectiveIds: ['objective_trace'] },
      { requirementId: 'requirement_timeline', purpose: 'TIMELINE_PROOF',
        description: comparison + ' Timeline eventは照合対象の文脈である。narrativeTimestampsは架空の表示時刻で、観測記録による裏付けではない。教材の合成時刻は合成値と明記し、実測値・時計同期・因果関係を捏造しない。時刻・識別情報が不足する比較は未確認とする。',
        grounds: [...structuredClone(artifactGrounds), ...events.map(event => ({
          sourceType: 'TIMELINE_EVENT', sourceId: event.eventId, attackNodeId: null }))],
        learningObjectiveIds: ['objective_trace'] },
      { requirementId: 'requirement_contradiction', purpose: 'CONTRADICTION_PROOF',
        description: `架空の証言者character_witnessがcharacter_defendantを対象に「${allegation}」と主張する。発言はTESTIMONYとして技術的事実から分離する。資料に裏付けられる観測内容の発言と、人物・意図を断定する主張は別statementとし、反駁が成立する部分と成立しない部分を資料から区別できるようにする。被告人の端末・アカウントとの対応は主張から事実化しない。資料が記録する内容と人物・意図を特定できるという推論の飛躍を反駁し、被告人が操作しなかったという事実には置き換えない。` + issueDesign,
        grounds: [...factGrounds, ...structuredClone(artifactGrounds), ...characterGrounds],
        learningObjectiveIds: ['objective_trace'] },
      { requirementId: 'requirement_exoneration', purpose: 'EXONERATION_PROOF',
        description: comparison + ' 別々に取得した2件以上の技術資料を比較し、character_witnessによるcharacter_defendantの人物・意図の特定は提示資料だけでは支えられない、という限定的な結論を示す。人物・Ground Truth参照は論証の対象と技術的文脈であり観測資料の代用ではない。人物対応、アリバイ、真犯人、積極的な非関与を補完しない。必要な補助資料を内部専用にせず、通常プレイですべて取得・閲覧可能にする。',
        grounds: [...characterGrounds, ...structuredClone(artifactGrounds), ...factGrounds],
        learningObjectiveIds: ['objective_trace'] },
      ...investigationPlan.map((item, index) => {
        const node = graph.nodes.find(node => node.nodeId === item.ground.attackNodeId);
        const attack = attacksById.get(node.attackDefinitionId);
        return { requirementId: `requirement_observation_${index + 1}`, purpose: 'ATTACK_TRACE',
          description: `${item.ground.sourceId}: ${item.description} `
            + `取得経路: ${item.sourceLabel} (${item.sourceNodeId}) / ${item.logSource} / ${item.actionId}。`
            + `種類${item.evidenceType}の別個の合成資料として取得する。主調査${attack.investigationTypes.join('・')}の答え「${attack.evidenceAnswer}」は観測事実と照合する対象であり、裏付けなしに資料本文へ事実として転記しない。`,
          grounds: [structuredClone(item.ground)], learningObjectiveIds: ['objective_trace'] };
      }),
    ],
  };
  const scenarioDraft = { schemaVersion: '1.0', scenarioId, state: 'DRAFT', attackGraphRef,
    groundTruthId: groundTruth.groundTruthId, characterSetId: characters.characterSetId,
    timelineId: timeline.timelineId, learningObjectiveSetId: learningObjectives.learningObjectiveSetId,
    evidenceRequirementSetId: evidenceRequirements.evidenceRequirementSetId };
  return { schemaVersion: '1.0', generationInputRef: {
    generationInputId: generationInput.generationInputId,
    inputDigest: generationInput.attackGraphRef.inputDigest,
    graphId: generationInput.attackGraphRef.graphId,
  }, scenarioDraft, groundTruth, characters, timeline, learningObjectives, evidenceRequirements };
}

// Revisionが文面を変えても、承認前の必要資料を落としてCoverageを縮小させない。
export function validateScenarioEvidenceCoverage({ generationInput, configuration, scenarioPackage }) {
  const plan = buildEvidenceInvestigationPlan(configuration, generationInput);
  const errors = [];
  for (const purpose of ['ATTACK_TRACE', 'TIMELINE_PROOF', 'CONTRADICTION_PROOF', 'EXONERATION_PROOF']) {
    const grounds = scenarioPackage.evidenceRequirements.requirements
      .filter(item => item.purpose === purpose).flatMap(item => item.grounds);
    for (const item of plan) if (!grounds.some(ground => ground.sourceType === 'ATTACK_GRAPH_ARTIFACT'
      && ground.attackNodeId === item.ground.attackNodeId && ground.sourceId === item.ground.sourceId)) {
      errors.push({ code: 'INVESTIGATION_COVERAGE_INCOMPLETE',
        field: 'scenarioPackage.evidenceRequirements.requirements',
        reason: `${purpose}に${item.ground.attackNodeId}/${item.ground.sourceId}の資料参照が不足しています。`,
        correctionHint: '説明文だけでなくgroundsへ既存artifact参照を追加し、取得経路と照合範囲を維持してください。' });
    }
  }
  return errors;
}
