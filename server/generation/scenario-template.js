// Scenarioの参照構造はAIに自由生成させず、検証済みConfigurationからBackendで組み立てる。
// AIは独立レビューと、指摘された記述・既存artifactへの不足参照の修正を担当する。
import { buildEvidenceInvestigationPlan, buildInvestigationStages } from './investigation-registry.js';
import { buildStageRequirements, validateStageRequirements } from './scenario-stage-plan.js';
import { fail } from './schema.js';
import { requestedCourtIssueCount } from './court-issues.js';
import { isDeepStrictEqual } from 'node:util';
import { phishingMaterialPolicy, scenarioInvestigationGoal, phishingObservationRequirement } from './attack-learning.js';
import { buildIncidentNarratives } from './incident-design.js';
import { presentationWordingProblems } from './court-claim-style.js';

// 2026-09-20 修正後: 記述の自由度と技術的な参照構造を分離する。
export function validateScenarioDesignBoundary(template, proposed) {
  const structure = value => {
    const copy = structuredClone(value);
    // CLI Structured Outputs spells an absent optional incident profile as null.
    if (copy.groundTruth?.incidentNarratives == null) delete copy.groundTruth?.incidentNarratives;
    if (copy.groundTruth?.caseFacts == null) delete copy.groundTruth?.caseFacts;
    for (const character of copy.characters?.characters ?? []) delete character.displayName;
    for (const objective of copy.learningObjectives?.objectives ?? []) delete objective.description;
    for (const requirement of copy.evidenceRequirements?.requirements ?? []) delete requirement.description;
    return copy;
  };
  if (!isDeepStrictEqual(structure(template), structure(proposed))) {
    fail('SCENARIO_DESIGN_BOUNDARY_CHANGED', 'scenario-import-package',
      '変更できるのは人物名と学習目標・証拠要件のdescriptionだけです。技術構造と全参照を維持してください。');
  }
  const prosecutionInvestigator = proposed.characters?.characters
    ?.find(character => character.characterId === 'character_witness');
  if (!prosecutionInvestigator?.displayName?.includes('検察側')) {
    fail('SCENARIO_PROSECUTION_INVESTIGATOR_ROLE_UNCLEAR', 'characters.character_witness.displayName',
      '検察側の主張を述べる人物だと画面上で判別できるよう、表示名に「検察側」を含めてください。');
  }
  for (const person of proposed.characters?.characters ?? []) {
    const problem = presentationWordingProblems(person.displayName)[0];
    if (problem) fail('SCENARIO_PRESENTATION_TERMINOLOGY', `characters.${person.characterId}.displayName`,
      problem.reason, { correctionHint: problem.correctionHint });
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
      { characterId: 'character_defendant', displayName: configuration.incidentContext.accusedRole,
        provenance: 'AI_GENERATED_SYNTHETIC', roles: ['defendant'], bindingRefs: [] },
      { characterId: 'character_attacker', displayName: '別の攻撃者',
        provenance: 'AI_GENERATED_SYNTHETIC', roles: ['attacker'], bindingRefs: [] },
      { characterId: 'character_witness', displayName: '検察側調査官',
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
  const incidentNarratives = buildIncidentNarratives(configuration, graph,
    generationInput.technicalInput.attackDefinitions);
  if (incidentNarratives.length) {
    groundTruth.incidentNarratives = incidentNarratives;
    for (const narrative of incidentNarratives) groundTruth.technicalFacts.push({
      factId: `fact_impact_${narrative.attackNodeId}`, sourceType: 'NODE_EFFECT',
      attackNodeId: narrative.attackNodeId, sourceId: narrative.impactEffectId });
    for (const character of characters.characters) {
      if (character.characterId === 'character_attacker') character.bindingRefs = graph.nodes.flatMap(node =>
        node.bindings.filter(binding => binding.name === 'attacker').map(binding => ({ attackNodeId: node.nodeId,
          bindingName: binding.name, entityId: binding.entityId })));
      if (character.characterId === 'character_defendant') character.bindingRefs = graph.nodes.flatMap(node => {
        // `victim` and `account` express an incident setting supplied by the
        // validated graph. This association must not be inferred from a log.
        const binding = node.bindings.find(item => item.name === 'victim')
          ?? node.bindings.find(item => item.name === 'account');
        return binding ? [{ attackNodeId: node.nodeId, bindingName: binding.name, entityId: binding.entityId }] : [];
      });
    }
  }

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

  const learningObjectives = {
    schemaVersion: '1.0', learningObjectiveSetId: `objectives_${suffix}`, scenarioId,
    attackGraphRef, objectives: [{ objectiveId: 'objective_trace',
      description: '選択された攻撃ごとに複数の観測資料を照合し、攻撃の仕組み、記録に現れる固有の特徴、各資料で確認できる範囲と未確認の点を説明する。処理の成立と人物への帰属を区別する。',
      origin: 'DERIVED_FROM_TECHNICAL_INPUT',
      selectedAttackIds: [...graph.selectedAttackIds], attackNodeIds: graph.nodes.map(node => node.nodeId),
      definitionReferenceRefs: graph.nodes.flatMap(node => node.referenceIds.slice(0, 1)
        .map(referenceId => ({ attackDefinitionId: node.attackDefinitionId, referenceId }))) }],
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
  const firstAttack = [...configuration.attacks].sort((a, b) => a.order - b.order)[0];
  const investigationIntents = [...configuration.attacks].sort((a, b) => a.order - b.order)
    .map(attack => attack.attackId + ' / 主調査 ' + attack.investigationTypes.join('・')
      + ': ' + (configuration.attacks.length === 1 ? scenarioInvestigationGoal(attack)
        : '答えの全文はこの攻撃の個別取得要件で照合する')).join(' / ');
  const hasEmailAndWeb = investigationPlan.some(item => item.ground.sourceId === 'email_record')
    && investigationPlan.some(item => item.ground.sourceId === 'web_access_record');
  const selectedIds = new Set(configuration.attacks.map(attack => attack.attackId));
  const hasLogin = selectedIds.has('unauthorized_login');
  const hasStored = selectedIds.has('stored_xss');
  const comparison = (hasEmailAndWeb
    ? '保存メールの誘導内容・リンクとWebアクセス記録の要求先・時刻を確認し、各資料が示す範囲を比較する。宿題の表示URLとhrefの不一致や特定の調査手順は必須にしない。公開本文で確認できる対応だけを説明し、不明な対応は未確認とする。メール保存はクリックの証明ではなく、要求記録もページ遷移の完了・クリック原因・操作人物・意図を示さない。'
    : '各資料の対象と記録時刻・記録範囲を照合する。')
    + (hasLogin ? ' 認証サービスの認証記録とWeb側のセッション監査をアカウントの合成識別子・時刻・記録範囲で照合する。認証成功、投稿権限、実際の投稿は別の事実で、認証記録は人物同定ではない。' : '')
    + (hasStored ? ' 保存投稿の識別子と非実行ソース抜粋、後の閲覧要求、ブラウザのスクリプト実行記録を照合する。保存が閲覧に先行する関係を維持し、反射型XSSとは区別する。アクセス成功だけでスクリプト実行を証明しない。' : '')
    + (selectedIds.has('credential_phishing') ? ' 偽フォームと正規ポータルは別サービスである。偽フォームへの送信・受信は取得可能な専用記録資料で照合する。秘密値を記録せず、リンク誘導だけから資格情報取得を推定しない。' : '')
    + (selectedIds.has('reflected_xss') || selectedIds.has('sql_injection')
      ? ' アクセス記録だけでスクリプト実行やSQL実行を証明せず、確認済みの実行記録・DB記録と区別する。' : '');
  const allegation = 'これらの技術記録は、被告人が自分の意思で対象の操作を行ったことを示している。';
  const issueDesign = ' 段階ごとの具体的な主張・対象人物・4択の論点・使用資料・反駁範囲はrequirement_stage_*のinvestigationStageとgroundsで定義する。そのorder順に攻撃ごとの各調査先一争点とし、これ以外の法廷を追加しない。同じ機器を使う別の攻撃も争点を分ける。各段階のgroundsは担当する攻撃の取得済み技術資料とし、必要なメールやWebページ本文も含め、全体要件の全資料を一つの争点に要求しない。各攻撃の技術資料が揃った段階で攻撃経路・処理結果・検察側の直接操作説との整合を評価する。事件全体の無罪論証は、すべての争点で成立した技術的な論証を合わせて示す。';
  const evidenceRequirements = {
    schemaVersion: '1.0', evidenceRequirementSetId: `requirements_${suffix}`, scenarioId,
    attackGraphRef, requirements: [
      { requirementId: 'requirement_attack', purpose: 'ATTACK_TRACE',
        description: `制作者の調査目的: ${investigationIntents}。これは全調査後の到達目標であり、各段階の正解ではない。 `
          + comparison + phishingMaterialPolicy(firstAttack.attackId) + ` 難易度${configuration.difficulty}・evidenceCount=${configuration.evidenceCount}は調査チェーンの基準で、法廷は調査対象に対応する${requestedCourtIssueCount(configuration, generationInput)}争点。取得資料総数の上限ではない。補助資料も個別の取得要件に従い通常プレイで取得する。`,
        grounds: structuredClone(artifactGrounds), learningObjectiveIds: ['objective_trace'] },
      { requirementId: 'requirement_timeline', purpose: 'TIMELINE_PROOF',
        description: comparison + ' Timeline eventは照合対象の文脈である。narrativeTimestampsは教材用の表示時刻で、観測記録による裏付けではない。教材用の合成時刻であることは生成条件とUIの資料枠で示し、EvidenceのpublicContentへ時刻注記の行を追加しない。実測値・時計同期・因果関係を捏造しない。時刻・識別情報が不足する比較は未確認とする。',
        grounds: [...structuredClone(artifactGrounds), ...events.map(event => ({
          sourceType: 'TIMELINE_EVENT', sourceId: event.eventId, attackNodeId: null }))],
        learningObjectiveIds: ['objective_trace'] },
      { requirementId: 'requirement_contradiction', purpose: 'CONTRADICTION_PROOF',
        description: `事件全体では、検察側調査官character_witnessによる資料の解釈を基に、character_defendantを対象に「${allegation}」とする検察側の立場を検討する。各法廷の反駁対象はinvestigationStageの攻撃固有の記録解釈とし、全体の主張を追加の争点として水増ししない。発言はTESTIMONYとして技術的事実から分離する。資料に裏付けられる観測内容の発言と、人物・意図を断定する主張は別statementとし、反駁が成立する部分と成立しない部分を資料から区別できるようにする。被告人の端末・アカウントとの対応は、検察側の主張だけから事実化しない。取得資料によって攻撃の成立経路・対象・結果を具体的に示し、その記録範囲が被告人による準備・作成・直接操作という検察側の主張を裏付けるかを検討する。資料にない人物、アリバイ、攻撃経路は追加せず、別人の特定を正解条件にしない。` + issueDesign,
        grounds: [...factGrounds, ...structuredClone(artifactGrounds), ...characterGrounds],
        learningObjectiveIds: ['objective_trace'] },
      { requirementId: 'requirement_exoneration', purpose: 'EXONERATION_PROOF',
        description: comparison + (incidentNarratives.length
          ? ' 別々に取得した2件以上の技術資料を比較し、事件で確認できる処理経路・対象・結果と記録の限界を具体的に示す。character_defendantによる攻撃処理の準備・作成・直接操作という検察側の説明が資料で裏付けられず、第三者による操作、認証情報の悪用、誘導または自動処理の可能性を排除できないことを無罪の根拠とする。第三者が実行したとの断定や人物の特定は要求しない。'
          : ' 別々に取得した2件以上の技術資料を比較し、character_witnessによるcharacter_defendantの人物・意図の特定は提示資料だけでは支えられない、という限定的な結論を示す。')
          + ' 人物・Ground Truth参照は論証の対象と技術的文脈であり、観測資料の代用ではない。定義されていない人物対応、アリバイ、攻撃経路を補完しない。必要な補助資料を内部専用にせず、通常プレイですべて取得・閲覧可能にする。',
        grounds: [...characterGrounds, ...structuredClone(artifactGrounds), ...factGrounds],
        learningObjectiveIds: ['objective_trace'] },
      // 2026-09-24 修正前: 先頭以外だけ別要件へ保存していた。
      // ...configuration.attacks.filter(attack => attack !== firstAttack).map((attack, index) => ({
      // 2026-09-24 修正後: 全攻撃の調査目的を個別要件に保持し、文字数上限と段階別の取得範囲を守る。
      ...configuration.attacks.map((attack, index) => ({
        requirementId: `requirement_goal_${index + 1}`, purpose: 'ATTACK_TRACE',
        description: `制作者の主調査 ${attack.investigationTypes.join('・')}: ${scenarioInvestigationGoal(attack)}。これは制作者の想定回答であり、Ground Truthで確認済みの事実ではない。原入力は制作設定に保持し、資料で確認する到達目標をここに定義する。段階ごとの回答はinvestigationStageで分割する。未取得資料を早い段階の回答に含めない。${phishingMaterialPolicy(attack.attackId)}`,
        grounds: investigationPlan.filter(item => graph.nodes.some(node => node.nodeId === item.ground.attackNodeId
          && node.attackDefinitionId === attack.attackId)).map(item => structuredClone(item.ground)),
        learningObjectiveIds: ['objective_trace'],
      })),
      ...investigationPlan.map((item, index) => {
        return { requirementId: `requirement_observation_${index + 1}`, purpose: 'ATTACK_TRACE',
          description: `${item.ground.sourceId}: ${item.description} `
            + `取得経路: ${item.sourceLabel} (${item.sourceNodeId}) / ${item.logSource} / ${item.actionId}。`
            + `種類${item.evidenceType}の別個の合成資料として取得する。この資料で観測できる範囲だけを記載し、全調査後の到達目標や他の取得元の記録を本文へ転記しない。`
            + phishingObservationRequirement(graph.nodes.find(node => node.nodeId === item.ground.attackNodeId).attackDefinitionId, item.ground.sourceId),
          grounds: [structuredClone(item.ground)], learningObjectiveIds: ['objective_trace'] };
      }),
      ...buildStageRequirements(configuration, generationInput),
    ],
  };
  if (incidentNarratives.length) {
    const technicalProofScope = '争点では、プレイヤーが通常の調査で取得できるメール、Webページ本文、アクセス記録、アプリケーション記録、端末記録など、選択された攻撃に必要な技術資料を全て照合する。各資料が直接示す事実と限界を区別し、要求・処理・結果の対応を原文の識別値で説明する。内部設定の観察記録や調査報告はプレイヤー向け資料にせず、証拠として要求しない。アカウント名、IP、端末の一致だけから人物を特定しない。';
    for (const requirementId of ['requirement_contradiction', 'requirement_exoneration']) {
      const requirement = evidenceRequirements.requirements.find(item => item.requirementId === requirementId);
      requirement.grounds = requirement.grounds.filter(ground => ground.sourceType !== 'CASE_FACT');
      requirement.description = `${technicalProofScope} ${issueDesign}`;
    }
  }
  evidenceRequirements.requirements = evidenceRequirements.requirements
    .filter(requirement => requirement.purpose !== 'IDENTITY_PROOF');
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
  return [...errors, ...validateStageRequirements(configuration, generationInput, scenarioPackage)];
}
