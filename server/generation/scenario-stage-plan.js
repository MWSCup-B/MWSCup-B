import { buildInvestigationStages } from './investigation-registry.js';
import { stageQuestionTasks, phishingMaterialPolicy } from './attack-learning.js';
import { buildQuestionBackground } from './investigation-lessons.js';

const key = ground => `${ground.attackNodeId}/${ground.sourceId}`;

// 記録の取得順と攻撃の実行順は別。登録済みの取得元を変えずに、争点を取得順へ割り当てる。
export function buildStageRequirements(configuration, generationInput) {
  const stages = buildInvestigationStages(configuration, generationInput);
  return stages.map((stage, index) => {
    const tasks = stageQuestionTasks(stages, index, generationInput);
    const questionNodes = new Set(tasks.map(task => task.attackNodeId));
    const current = stage.routes.map(route => route.ground).filter(ground => questionNodes.has(ground.attackNodeId));
    const available = stages.slice(0, index + 1).flatMap(item => item.routes.map(route => route.ground));
    const has = id => current.some(ground => ground.sourceId === id);
    let grounds = current;
    let claim, questionFocus, expectedInference, limitedRefutation;
    if (has('email_record')) {
      claim = 'このメールにリンクが残っているので、そのリンクへアクセスしたことも分かります。';
      questionFocus = '保存メールの誘導内容・リンクを読み、本文に書かれた案内と実際のアクセスの記録を区別する4択。';
      expectedInference = '保存メールから確認できるのは案内やリンクの内容であり、保存されているだけでは実際のアクセスやフォームへの送信は確認できない。';
      limitedRefutation = '保存メールのリンクの存在を実際のアクセスと同一視する部分だけを反駁する。未取得のWeb記録やURLの不一致を必要条件にしない。';
    } else if (has('clickfix_page_record')) {
      claim = 'この修復案内が表示されたなら、端末の処理も動いたはずです。';
      questionFocus = '偽案内の保存内容と応答の記録から、案内表示と端末側の実行を区別する4択。';
      expectedInference = '保存された案内は端末操作を促しているが、応答の記録だけでは利用者が実行したか分からない。ClickFixの実行には利用者の端末操作が必要。';
      limitedRefutation = '表示から実行成功を断定する部分だけを反駁する。後続の端末計測や暗号化資料をまだ要求しない。';
    } else if (has('spray_authentication_record')) {
      claim = '複数のアカウントで失敗している。全部、同じパスワードを試したと分かりますね。';
      questionFocus = '対象アカウント・時刻・成否を読み、認証監査が記録していない秘密値まで推測できるかを選ぶ4択。';
      expectedInference = '複数アカウントへの試行とその成否は確認できる。ただし秘密値を記録しないこの資料だけでは、同じ候補を使ったことまでは断定できない。';
      limitedRefutation = '多数アカウントへの少数候補試行というパスワードスプレーの定義を説明し、観測パターンと秘密値の証明を区別する。失敗を認証成功や操作者の特定へ読み替えない。';
    } else if (has('authentication_policy_record')) {
      claim = 'ロックアウトの設定があるなら、不審な試行は全部止まったはずです。';
      questionFocus = '事件時の保存設定に記載された適用条件と、試行の実際の成否を区別する4択。';
      expectedInference = '設定には適用範囲と条件がある。設定の存在だけで、すべての試行が遮断されたとは断定できない。';
      limitedRefutation = '設定の存在を全試行の遮断と同一視する部分だけを反駁する。現在の設定を当時の設定に代用せず、遮断回避の操作は扱わない。';
    } else if (has('upload_receipt_record')) {
      claim = '画像という名前で送られたのですから、中身も画像でしょう。';
      questionFocus = '申告されたファイル名・Content-Typeと、実際の内容検査の違いを選ぶ4択。';
      expectedInference = '名前やContent-Typeは送信側が申告する値であり、それだけで保存ファイルの内容は確定しない。';
      limitedRefutation = '申告値だけで実際の内容を断定する部分だけを反駁する。まだ取得していない保存ファイルの内容を正解の必須条件にしない。';
    } else if (has('uploaded_file_record')) {
      claim = '不正なファイルが保存された。サーバーで実行されたのも確実ですね。';
      questionFocus = '内容検査と非実行の保存先設定から、許可外ファイルの保存とコード実行を区別する4択。';
      expectedInference = '保存IDと内容検査で許可外ファイルの保存は確認できるが、非実行の保存領域への保存はコード実行を意味しない。';
      limitedRefutation = '保存から実行への飛躍だけを反駁する。別の未選択攻撃や実際の操作者は補完しない。';
    } else if (has('process_execution_record')) {
      claim = 'プロセスの起動が記録されている。狙った被害もすべて起きたはずです。';
      questionFocus = '端末計測の起動結果と、その後のファイル変更などの結果を区別する4択。';
      expectedInference = '記録された端末ID・実行ユーザー識別子・起動結果は確認できるが、起動だけで後続の処理完了や被害範囲を断定できない。実行ユーザー識別子は権限や実際の操作者を示すものではなく、被告人本人の操作や意図はこの資料だけでは確認できない。';
      limitedRefutation = '起動を被害完了と同一視する部分だけを反駁する。未取得のファイル検査結果や人物の意図は要求しない。';
    } else if (has('file_encryption_record')) {
      claim = 'この端末のファイルが暗号化された。組織の全ファイルも同じ状態でしょう。';
      questionFocus = '暗号化確認結果と対象パスから、検査した範囲と未調査の範囲を区別する4択。';
      expectedInference = '変更前後の検査と暗号化確認結果が示す対象範囲だけを確認する。対象外ファイルや外部流出まで証明する記録ではない。';
      limitedRefutation = '一部の検査から全体の被害を断定する部分だけを反駁する。拡張子変更だけを暗号化の証明にしない。';
    } else if (has('database_statement_record')) {
      claim = 'SQLが動いたなら、サーバーのOSも自由に操作できたはずです。';
      questionFocus = 'DB監査が示すSQLの実行と、DB主体の権限・OS実行の違いを選ぶ4択。';
      expectedInference = '対象要求に対応するSQLの実行はDB監査の範囲で確認する。アプリケーションのDB権限を越えた操作やOS実行は示していない。';
      limitedRefutation = 'SQL実行からOS権限への飛躍だけを反駁する。記録にない流出や操作者は断定しない。';
    } else if (has('credential_submission_record')) {
      claim = '偽フォームにはアクセスしただけです。データを送った記録はないでしょう。';
      questionFocus = 'アクセス記録と専用の送信・受信計測を比較し、単なる閲覧と送受信成立の違いを選ぶ4択。';
      expectedInference = '専用の送信・受信計測に記録された送信先・時刻・非秘密の合成相関IDを照合し、リンクへのアクセスだけでなく偽フォームへの送信・受信を確認する。秘密値や定義されていない処理結果欄は使わない。';
      limitedRefutation = '送受信の有無という記録解釈だけを反駁する。通常のアクセスログに秘密値が残ると仮定せず、正規サービスへの認証成功や操作者は断定しない。';
    } else if (has('stored_content_record')) {
      claim = 'Webサーバーに投稿が保存されていた。それだけで、ブラウザで実行された証拠になりますね。';
      questionFocus = '保存投稿とWeb要求の記録が示す範囲を読み、保存・閲覧要求と実行成功を区別する4択。';
      expectedInference = '保存資料と閲覧要求は確認できるが、これらだけではブラウザでの実行成功は分からない。';
      limitedRefutation = '「保存されたから実行も成功した」という飛躍だけを反駁する。実行の成否そのものは端末計測を取得するまで結論にしない。認証記録も使わない。';
    } else if (has('browser_execution_record')) {
      grounds = [...available.filter(ground => ['stored_content_record', 'web_access_record'].includes(ground.sourceId)), ...current];
      claim = 'ブラウザはページを表示しただけ。スクリプトが動いた記録はありませんよ。';
      questionFocus = '今回取得した実行計測と取得済みの対象資料を照合し、閲覧履歴ではなく実行の観測から言えることを選ぶ4択。';
      expectedInference = '対応するブラウザ実行計測が示す範囲で実行を確認できる。アクセス成功や保存ソースだけからの推測とは区別する。';
      limitedRefutation = '「実行した記録がない」という主張だけを反駁する。被告人の操作や意図、計測されていない影響は断定しない。';
    } else if (has('authentication_record')) {
      claim = '認証成功の記録さえあれば、その後の投稿完了も分かります。';
      questionFocus = '認証記録が示す処理範囲を読み、認証成功と投稿完了を区別する4択。';
      expectedInference = '認証成功の記録は認証の結果であり、別の処理である投稿完了までは示さない。';
      limitedRefutation = '認証結果を投稿完了と同一視する部分だけを反駁し、投稿の実行者を断定しない。';
    } else if (current.some(ground => /^(ssh_|traversal_|sudo_|setuid_|service_|collection_)/.test(ground.sourceId))) {
      // 2026-09-24: mainのローカル攻撃にWeb要求を捏造せず、今回の観測範囲を問う。
      claim = 'この設定や記録だけで、関係するすべての操作の成功と権限を断定できます。';
      questionFocus = '今回の資料が示す設定・操作・実効権限と、まだ確認できない処理を区別する4択。';
      expectedInference = '取得した資料に記録された対象と状態だけを確認し、設定の存在と実行の観測を区別する。';
      limitedRefutation = '今回の資料の記録範囲を越えた成功・権限の断定だけを反駁する。未取得の資料や操作を追加しない。';
    } else {
      claim = 'Web側に要求の記録が残った。それなら、その先の処理も成功したはずです。';
      questionFocus = '取得した要求・セッションの記録範囲から、要求の記録と後続処理の成功を区別する4択。';
      expectedInference = '要求の到達やセッションの状態は、その記録範囲で確認する。後続の実行成功は対応する処理側の記録がなければ断定できない。';
      limitedRefutation = '要求の記録だけで後続処理の成功まで断定する部分を反駁する。まだ取得していない端末・DB・認証の資料を要求しない。';
    }
    const completed = tasks.filter(task => task.complete);
    // Reuse only acquired observations of the same selected attack. Never borrow a
    // similarly named record from a different attack node to fill a missing source.
    grounds = [...new Map([...grounds, ...tasks.flatMap(task => task.grounds)]
      .map(ground => [key(ground), ground])).values()];
    if (completed.length) {
      const claims = {
        phishing: 'メールとWeb要求の記録がそろえば、ページの表示完了やその後の処理成功も分かります。',
        credential_phishing: 'ページを閲覧しただけで、偽フォームへ送信した資料はありません。',
        stored_xss: 'ブラウザはページを開いただけで、保存された投稿の実行を示す記録はありません。',
        reflected_xss: '要求がサーバーに届いただけで、ブラウザで動いたことを示す記録はありません。',
        sql_injection: '入力は検索する値として処理されただけで、SQLの条件や構造には影響していません。',
        unauthorized_login: '認証されたアカウントとWeb側のセッションを照合する必要はありません。認証成功なら、対象Webでどんな操作も許されます。',
        clickfix: '案内の要求IDと端末のプロセスIDは、同じ操作を示す番号です。実行ユーザーの記録から、被告人が案内に従って起動したと分かります。',
        password_spray: '認証の制限設定があるので、記録された不審な試行はすべて遮断されたはずです。',
        ransomware: 'ファイルの変化は名前だけで、内容が暗号化されたと確認できる資料はありません。',
        unrestricted_file_upload: '受付記録と検査資料は、保存IDが違っても名前が同じなら同じファイルです。許可外の内容が見つかれば、サーバーでの実行も証明できます。',
      };
      const focus = completed.at(-1);
      const attackId = generationInput.technicalInput.attackGraph.nodes
        .find(node => node.nodeId === focus.attackNodeId).attackDefinitionId;
      claim = claims[attackId] ?? focus.claim;
      questionFocus = `${completed.map(task => task.name).join('・')}の取得済み資料を比較し、対象・値の対応と攻撃の特徴、記録から判断できる範囲を問う4択。対象が分かる読みやすい問題文にする。`;
      expectedInference = completed.map(task => task.comparison + task.limit).join('\n');
      limitedRefutation = 'この主張を資料の比較で反駁する。各資料が観測する段階を分け、単一資料に攻撃全体の結論を書かない。' + focus.limit;
      if (attackId === 'clickfix') {
        questionFocus = '保存案内の要求ID・応答時刻・求める操作と、今回の端末計測の端末ID・プロセスID・親子関係・実行ユーザー・起動結果を読み比べる。二つのIDが識別する対象の違い、起動の確認範囲、被告人への帰属を選ぶ4択。各資料の実在する値を使い、対応の欠落は未確認とする。';
        expectedInference = focus.comparison + focus.limit
          + '要求IDはWeb要求、プロセスIDは端末上の処理を識別する。両資料の実値を列挙して記録対象と段階を比較し、同じ意味の番号として扱わない。端末の親子関係は起動元と起動先、実行ユーザーはアカウント、起動結果は計測された処理の結果に限る。案内からその起動への対応・因果が資料で確認できなければ未確認と明記し、被告人本人が案内に従ったとは断定しない。';
        limitedRefutation = '第1段階の「案内表示だけで実行成功」という論点を繰り返さず、今回初めて得た端末計測と保存案内の記録単位・実値を比較する。要求IDとプロセスIDの同一視、および実行ユーザーから被告人本人の操作・意図を断定する部分を限定的に反駁する。人物対応、共通ID、時刻の一致、因果を新設しない。';
      }
    }
    if (index === stages.length - 1) {
      grounds = available;
      if (!claim.includes('被告人')) claim += 'これで、被告人本人による操作だと分かります。';
      questionFocus += '同じ最終争点の中で、記録上の処理と被告人本人への帰属も区別する。';
      expectedInference += '取得済み資料が示す処理と、被告人本人が行ったという主張は別である。アカウント・端末の記録から本人の操作や意図を証明したとは言えない。';
      limitedRefutation += 'このclaimの被告人本人への帰属も、既存の最終法廷内で裏付け不足として限定的に反駁する。別の法廷を追加しない。被告人の非関与や別人の実行は補完しない。';
    }
    const learningDesign = tasks.map(task => task.complete
      ? `${task.name}: ${task.comparison} ${task.limit} この攻撃の必要資料をすべて取得済み。複数資料の照合を正答の必須条件にする。`
      : `${task.name}: 今回はgrounds内の資料の観測項目と記録範囲を読む。${task.limit} 未取得の資料は今回の解答に使わない。攻撃全体の比較は必要な資料がそろう後の段階で行う。`).join('\n');
    const materialPolicy = tasks.map(task => phishingMaterialPolicy(generationInput.technicalInput.attackGraph.nodes
      .find(node => node.nodeId === task.attackNodeId).attackDefinitionId)).filter(Boolean).join('\n');
    if (materialPolicy) {
      expectedInference += materialPolicy;
      limitedRefutation += 'URL不一致は必須ではない。扱う場合は公開本文内の比較結果に限定し、Ground Truthに事件事実を追加しない。';
    }
    return { requirementId: `requirement_stage_${index + 1}`, purpose: 'CONTRADICTION_PROOF',
      description: `第${index + 1}段階: ${stage.displayName}。investigationStageの主張は架空の証言であり技術的事実ではない。groundsの観測資料だけをこの段階の4択・反駁に使う。今回の資料は観測資料ごとの取得要件に示された既存の取得元・操作で取得し、以前の資料は収集済みのものを使う。\n${learningDesign}\n問題文に必要な攻撃の仕組み・用語の背景：${buildQuestionBackground(stages, index, generationInput)} この背景は制作資料であり、問題の前には表示しない。必要な定義だけを問題文に組み込み、実際の事件の経緯は取得済み資料の値と確認できる時系列から説明する。答えや将来の資料を先に示さない。`,
      investigationStage: { targetId: stage.targetId, order: index + 1, sourceNodeId: stage.sourceNodeId,
        witnessCharacterId: 'character_witness', subjectCharacterId: 'character_defendant',
        claim, questionFocus, expectedInference, limitedRefutation },
      grounds: structuredClone(grounds), learningObjectiveIds: ['objective_trace'] };
  });
}

export function validateStageRequirements(configuration, generationInput, scenarioPackage) {
  const stages = buildInvestigationStages(configuration, generationInput);
  const requirements = scenarioPackage.evidenceRequirements.requirements.filter(item => item.investigationStage);
  const errors = [];
  const problem = reason => errors.push({ code: 'INVESTIGATION_STAGE_PLAN_INVALID',
    field: 'scenarioPackage.evidenceRequirements.requirements', reason,
    correctionHint: '各調査先に一つのinvestigationStageを割り当て、現在・過去の観測資料だけをgroundsへ指定してください。' });
  if (requirements.length !== stages.length) problem('調査対象数と段階別の争点数が一致しません。');
  stages.forEach((stage, index) => {
    const matches = requirements.filter(item => item.investigationStage.targetId === stage.targetId);
    if (matches.length !== 1) { problem(`${stage.targetId}の争点が一意に定義されていません。`); return; }
    const requirement = matches[0];
    const plan = requirement.investigationStage;
    if (plan.order !== index + 1 || plan.sourceNodeId !== stage.sourceNodeId
      || requirement.purpose !== 'CONTRADICTION_PROOF') problem(`${stage.targetId}の順序・取得元・用途が一致しません。`);
    for (const [field, role] of [['witnessCharacterId', 'witness'], ['subjectCharacterId', 'defendant']]) {
      if (!scenarioPackage.characters.characters.some(person => person.characterId === plan[field]
        && person.roles.includes(role))) problem(`${stage.targetId}の${field}が該当する人物を参照していません。`);
    }
    for (const task of stageQuestionTasks(stages, index, generationInput)) {
      if (task.grounds.some(expected => !requirement.grounds.some(ground => key(ground) === key(expected)))) {
        problem(`${stage.targetId}で${task.name}を学ぶための取得済み比較資料が不足しています。`);
      }
    }
    const available = new Set(stages.slice(0, index + 1).flatMap(item => item.routes.map(route => key(route.ground))));
    const grounds = requirement.grounds.filter(ground => ground.sourceType === 'ATTACK_GRAPH_ARTIFACT');
    if (grounds.some(ground => !available.has(key(ground)))) problem(`${stage.targetId}が未取得の後続資料を必要としています。`);
    if (!stage.routes.some(route => grounds.some(ground => key(ground) === key(route.ground)))) {
      problem(`${stage.targetId}の争点に現在の調査資料が指定されていません。`);
    }
  });
  return errors;
}

// Evidence工程でも、検証済みの段階別必要資料を別の資料へすり替えない。
export function stageEvidenceProblems(evidenceSet, scenarioPackage) {
  const requirements = scenarioPackage.evidenceRequirements.requirements
    .filter(item => item.investigationStage).sort((a, b) => a.investigationStage.order - b.investigationStage.order);
  const statements = evidenceSet.evidenceArtifacts.filter(item => item.type === 'TESTIMONY')
    .flatMap(item => item.testimony.statements).filter(item => item.technicalAssessment === 'CONTRADICTED');
  return requirements.flatMap((requirement, index) => {
    const evidenceIds = evidenceSet.contradictions.filter(item => item.statementRef === statements[index]?.statementId)
      .flatMap(item => item.conflictingEvidenceIds);
    const covered = new Set(evidenceSet.evidenceArtifacts.filter(item => item.type !== 'TESTIMONY'
      && evidenceIds.includes(item.evidenceId)).flatMap(item => item.sourceRefs
      .filter(ground => ground.sourceType === 'ATTACK_GRAPH_ARTIFACT').map(key)));
    const missing = requirement.grounds.filter(ground => ground.sourceType === 'ATTACK_GRAPH_ARTIFACT'
      && !covered.has(key(ground)));
    const distinctSources = new Set(requirement.grounds.filter(ground => ground.sourceType === 'ATTACK_GRAPH_ARTIFACT')
      .map(ground => ground.sourceId));
    const problems = [];
    if (distinctSources.size > 1 && new Set(evidenceIds).size < 2) problems.push({
      code: 'INVESTIGATION_LEARNING_COMPARISON_MISSING', field: `evidenceSet.contradictions.${requirement.investigationStage.targetId}`,
      reason: '異なる種類の観測資料を一つの結論資料へまとめず、取得可能な複数の技術資料を比較する争点にしてください。',
      correctionHint: '入力に定義済みの各取得資料を分け、比較に使うすべての資料をconflictingEvidenceIdsに指定してください。' });
    if (missing.length) problems.push({ code: 'INVESTIGATION_STAGE_EVIDENCE_MISSING',
      field: `evidenceSet.contradictions.${requirement.investigationStage.targetId}`,
      reason: `検証済みの第${index + 1}段階に必要な資料が反駁の根拠から抜けています: ${missing.map(key).join(', ')}。`,
      correctionHint: '段階別Requirementのgroundsに対応する取得可能資料を、この段階のconflictingEvidenceIdsとsupportingQuotesへ割り当ててください。' });
    return problems;
  });
}
