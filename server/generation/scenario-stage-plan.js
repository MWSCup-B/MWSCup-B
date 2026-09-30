import { buildInvestigationStages } from './investigation-registry.js';
import { stageQuestionTasks, phishingStagePolicy, investigationSourceLabel } from './attack-learning.js';
import { buildQuestionBackground } from './investigation-lessons.js';
import { hasSelfDisclosingShortcut } from './court-claim-style.js';

const key = ground => `${ground.attackNodeId}/${ground.sourceId}`;

// Incident metadata owns the accusation. Turn its third-person description into
// a prosecutor's courtroom statement without maintaining an attack-id text map.
export function spokenProsecutionClaim(allegation, fallback) {
  if (typeof allegation !== 'string' || !allegation.trim()) return fallback;
  const parts = allegation.trim().match(/^(.*?)、?検察側は、?(.*?)と主張している。?$/);
  if (!parts) return allegation;
  const basis = parts[1].replace(/、$/, '').replace(/を根拠として$|ことから$|ため$/, '')
    .replace(/こと$/, '').trim().replaceAll('当該', 'その');
  const conclusion = parts[2].trim().replaceAll('当該', 'その');
  return basis && conclusion ? `${basis}。つまり、${conclusion}ということです。` : allegation;
}

// 記録の取得順と攻撃の実行順は別。登録済みの取得元を変えずに、争点を取得順へ割り当てる。
export function buildStageRequirements(configuration, generationInput) {
  const stages = buildInvestigationStages(configuration, generationInput);
  return stages.map((stage, index) => {
    const tasks = stageQuestionTasks(stages, index, generationInput);
    const questionNodes = new Set(tasks.map(task => task.attackNodeId));
    const current = stage.routes.map(route => route.ground).filter(ground => questionNodes.has(ground.attackNodeId));
    const available = stages.slice(0, index + 1).flatMap(item => item.routes.map(route => route.ground))
      .filter(ground => questionNodes.has(ground.attackNodeId));
    const has = id => current.some(ground => ground.sourceId === id);
    let grounds = current;
    let claim, questionFocus, expectedInference, limitedRefutation;
    if (has('email_record')) {
      claim = '保存メールには誘導リンクがあります。受信者は、このリンクから対象ページを開いたと考えるのが自然です。';
      questionFocus = '保存メールの誘導内容・リンクを読み、本文に書かれた案内と実際のアクセスの記録を区別する4択。';
      expectedInference = '保存メールから確認できるのは案内やリンクの内容であり、保存されているだけでは実際のアクセスやフォームへの送信は確認できない。';
      limitedRefutation = '保存メールのリンクの存在を実際のアクセスと同一視する部分だけを反駁する。未取得のWeb記録やURLの不一致を必要条件にしない。';
    } else if (has('clickfix_page_record')) {
      claim = '修復案内が端末に表示されています。その直後に、案内どおりの処理も端末で動いたと考えています。';
      questionFocus = '偽案内の保存内容と応答の記録から、案内表示と端末側の実行を区別する4択。';
      expectedInference = '保存された案内は端末操作を促しているが、応答の記録だけでは利用者が実行したか分からない。ClickFixの実行には利用者の端末操作が必要。';
      limitedRefutation = '表示から実行成功を断定する部分だけを反駁する。後続の端末記録や暗号化資料をまだ要求しない。';
    } else if (has('spray_authentication_record')) {
      claim = '複数のアカウントで、認証の失敗が続いています。同じパスワード候補を順番に試したのでしょう。';
      questionFocus = '対象アカウント・時刻・成否を読み、認証監査が記録していない秘密値まで推測できるかを選ぶ4択。';
      expectedInference = '複数アカウントへの試行とその成否は確認できる。ただし秘密値を記録しないこの資料だけでは、同じ候補を使ったことまでは断定できない。';
      limitedRefutation = '多数アカウントへの少数候補試行というパスワードスプレーの定義を説明し、観測パターンと秘密値の証明を区別する。失敗を認証成功や操作者の特定へ読み替えない。';
    } else if (has('authentication_policy_record')) {
      claim = '事件時にはロックアウト設定が有効でした。記録された不審な試行は、この設定によって遮断されています。';
      questionFocus = '事件時の保存設定に記載された適用条件と、試行の実際の成否を区別する4択。';
      expectedInference = '設定には適用範囲と条件がある。設定の存在だけで、すべての試行が遮断されたとは断定できない。';
      limitedRefutation = '設定の存在を全試行の遮断と同一視する部分だけを反駁する。現在の設定を当時の設定に代用せず、遮断回避の操作は扱わない。';
    } else if (has('upload_receipt_record')) {
      claim = '画像という名前で送られたのですから、中身も画像でしょう。';
      questionFocus = '申告されたファイル名・Content-Typeと、実際の内容検査の違いを選ぶ4択。';
      expectedInference = '名前やContent-Typeは送信側が申告する値である。保存後の検査結果と照合して、実際のファイル内容を判断する。';
      limitedRefutation = '申告値だけで実際の内容を断定する部分だけを反駁する。まだ取得していない保存ファイルの内容を正解の必須条件にしない。';
    } else if (has('uploaded_file_record')) {
      claim = '許可されていない内容のファイルが、サーバーに保存されています。なら、そのファイルはサーバー上で実行されたと考えられます。';
      questionFocus = '内容検査と非実行の保存先設定から、許可外ファイルの保存とコード実行を区別する4択。';
      expectedInference = '保存IDと内容検査で許可外ファイルの保存は確認できるが、非実行の保存領域への保存はコード実行を意味しない。';
      limitedRefutation = '保存から実行への飛躍だけを反駁する。別の未選択攻撃や実際の操作者は補完しない。';
    } else if (has('file_operation_record')) {
      claim = '不審なプログラムが起動した直後に、多数のファイルが操作されています。このプログラムが対象ファイルを破壊したと考えられます。';
      questionFocus = 'ファイル操作の時間帯・対象・操作種別と、対応するプロセスの実行情報・親子関係を読む4択。';
      expectedInference = '同じ端末の相関ID・PIDで書込み、改名、文書作成を実行情報に対応付け、記録された親プロセスをたどれる。起動だけではファイル内容や全体の被害範囲は確定しない。実行ユーザー識別子は権限や実際の操作者を示すものではなく、本人の操作・意図は断定できない。';
      limitedRefutation = '起動と実際のファイル操作を区別し、未取得の被害ファイル・正常版の比較や暗号化方式を要求しない。SSHや人物・意図を補完しない。';
    } else if (has('process_execution_record')) {
      claim = '対象のプロセスは起動しています。予定されていた処理も終わり、被害が出たと考えられます。';
      questionFocus = '端末記録の起動結果と、その後のファイル変更などの結果を区別する4択。';
      expectedInference = '記録された端末ID・実行ユーザー識別子・起動結果は確認できるが、起動だけで後続の処理完了や被害範囲を断定できない。実行ユーザー識別子は権限や実際の操作者を示すものではなく、被告人本人の操作や意図はこの資料だけでは確認できない。';
      limitedRefutation = '起動を被害完了と同一視する部分だけを反駁する。未取得のファイル検査結果や人物の意図は要求しない。';
    } else if (has('file_encryption_record')) {
      claim = 'この端末では、ファイルが暗号化されています。組織内のほかの対象ファイルにも、同じ被害が出たと考えられます。';
      questionFocus = '暗号化確認結果と対象パスから、検査した範囲と未調査の範囲を区別する4択。';
      expectedInference = '変更前後の検査と暗号化確認結果が示す対象範囲だけを確認する。対象外ファイルや外部流出まで証明する記録ではない。';
      limitedRefutation = '一部の検査から全体の被害を断定する部分だけを反駁する。拡張子変更だけを暗号化の証明にしない。';
    } else if (has('database_statement_record')) {
      claim = 'DB監査には、SQLを実行した記録があります。攻撃者はDBだけでなく、サーバー自体も操作できたと考えられます。';
      questionFocus = 'DB監査が示すSQLの実行と、DB主体の権限・OS実行の違いを選ぶ4択。';
      expectedInference = '対象要求に対応するSQLの実行はDB監査の範囲で確認する。アプリケーションのDB権限を越えた操作やOS実行は示していない。';
      limitedRefutation = 'SQL実行からOS権限への飛躍だけを反駁する。記録にない流出や操作者は断定しない。';
    } else if (has('credential_submission_record')) {
      claim = '偽フォームにはアクセスしただけです。データを送った記録はないでしょう。';
      questionFocus = 'アクセス記録と専用の送信・受信記録を比較し、単なる閲覧と送受信成立の違いを選ぶ4択。';
      expectedInference = '専用の送信・受信記録に記録された送信先・時刻・非秘密の合成相関IDを照合し、リンクへのアクセスだけでなく偽フォームへの送信・受信を確認する。秘密値や定義されていない処理結果欄は使わない。';
      limitedRefutation = '送受信の有無という記録解釈だけを反駁する。通常のアクセスログに秘密値が残ると仮定せず、正規サービスへの認証成功や操作者は断定しない。';
    } else if (has('stored_content_record')) {
      claim = '問題の投稿はWebサーバーに保存され、その後に閲覧もされています。投稿に含まれる処理は、ブラウザで動いたはずです。';
      questionFocus = '保存投稿とWeb要求の記録が示す範囲を読み、保存・閲覧要求と実行成功を区別する4択。';
      expectedInference = '保存資料と閲覧要求は確認できるが、これらだけではブラウザでの実行成功は分からない。';
      limitedRefutation = '「保存されたから実行も成功した」という飛躍だけを反駁する。実行の成否そのものは端末記録を取得するまで結論にしない。認証記録も使わない。';
    } else if (has('browser_execution_record')) {
      grounds = [...available.filter(ground => ['stored_content_record', 'web_access_record'].includes(ground.sourceId)), ...current];
      claim = 'ブラウザにはページ表示の記録しかなく、スクリプトの実行を示す記録はありません。';
      questionFocus = '今回取得した実行記録と取得済みの対象資料を照合し、閲覧履歴ではなく実行の観測から言えることを選ぶ4択。';
      expectedInference = '対応するブラウザのスクリプト実行記録が示す範囲で実行を確認できる。アクセス成功や保存ソースだけからの推測とは区別する。';
      limitedRefutation = '「実行した記録がない」という主張だけを反駁する。被告人の操作や意図、記録されていない影響は断定しない。';
    } else if (has('authentication_record')) {
      claim = '対象アカウントで認証に成功しています。そのセッションから、投稿も行われたと考えています。';
      questionFocus = '認証記録が示す処理範囲を読み、認証成功と投稿完了を区別する4択。';
      expectedInference = '認証成功の記録は認証の結果であり、別の処理である投稿完了までは示さない。';
      limitedRefutation = '認証結果を投稿完了と同一視する部分だけを反駁し、投稿の実行者を断定しない。';
    } else if (current.some(ground => /^(ssh_|traversal_|sudo_|setuid_|service_|collection_)/.test(ground.sourceId))) {
      // 2026-09-24: mainのローカル攻撃にWeb要求を捏造せず、今回の観測範囲を問う。
      const recordLabel = investigationSourceLabel(stage.routes.filter(route => route.ground.sourceType === 'ATTACK_GRAPH_ARTIFACT'));
      claim = `${recordLabel}が残っています。関連する処理も、必要な権限で成功したと考えています。`;
      questionFocus = '今回の資料が示す設定・操作・実効権限と、まだ確認できない処理を区別する4択。';
      expectedInference = '取得した資料に記録された対象と状態だけを確認し、設定の存在と実行の観測を区別する。';
      limitedRefutation = '今回の資料の記録範囲を越えた成功・権限の断定だけを反駁する。未取得の資料や操作を追加しない。';
    } else {
      claim = 'Webアプリケーションには、対象の要求を受け付けた記録があります。その後の処理も、正常に終わったと考えられます。';
      if (tasks.some(task => task.sources.includes('database_statement_record')))
        claim = 'Web側には、対象の要求を受け付けた記録があります。対応するSQLも、問題なく実行されたと考えられます。';
      else if (tasks.some(task => task.sources.includes('browser_execution_record')))
        claim = 'ページへの要求を受け付けた記録があります。ページ内のスクリプトも、ブラウザで動いたと考えられます。';
      questionFocus = '取得した要求・セッションの記録範囲から、要求の記録と後続処理の成功を区別する4択。';
      expectedInference = '要求の到達やセッションの状態は、その記録範囲で確認する。後続の実行成功は対応する処理側の記録がなければ断定できない。';
      limitedRefutation = '要求の記録だけで後続処理の成功まで断定する部分を反駁する。まだ取得していない端末・DB・認証の資料を要求しない。';
    }
    const completed = tasks.filter(task => task.complete);
    if (!completed.length && stage.routes.some(route => route.ground.sourceId === 'application_response_record')) {
      expectedInference = 'アクセス記録は要求を示す。応答監査は記録された返却対象と応答状態を示すが、実行SQLの構造までは示さない。対応するDB監査を取得してからstatement欄を照合する。';
      limitedRefutation = 'アクセス記録だけで後続処理の成功が分かるという部分を反駁する。応答監査で確認できる返却と、まだ未取得の実行SQLの構造を混同しない。';
    }
    // Reuse only acquired observations of the same selected attack. Never borrow a
    // similarly named record from a different attack node to fill a missing source.
    grounds = [...new Map([...grounds, ...tasks.flatMap(task => task.grounds)]
      .map(ground => [key(ground), ground])).values()];
    if (completed.length) {
      const focus = completed.at(-1);
      const attackNode = generationInput.technicalInput.attackGraph.nodes
        .find(node => node.nodeId === focus.attackNodeId);
      const attackId = attackNode.attackDefinitionId;
      const definition = generationInput.technicalInput.attackDefinitions.find(item => item.id === attackId);
      const incident = definition?.incidentNarrative;
      const applicableAllegation = incident && attackNode.effects
        .some(effect => effect.predicate === incident.impactEffectPredicate) ? incident.allegation : null;
      const legacySqlClaim = '対象の要求に含まれる入力は値としてだけ扱われ、実行されたSQLの構造を変えていません。';
      claim = spokenProsecutionClaim(applicableAllegation,
        attackId === 'sql_injection' ? legacySqlClaim : (focus.claim ?? claim));
      if (!applicableAllegation && attackId === 'phishing')
        claim = '保存メールのリンク先と、Web要求の対象は一致しています。受信者がメールのリンクを開き、この要求を送ったと考えられます。';
      questionFocus = `${completed.map(task => task.name).join('・')}の取得済み資料を比較し、対象・値の対応と攻撃の特徴、記録から判断できる範囲を問う4択。対象が分かる読みやすい問題文にする。`;
      expectedInference = completed.map(task => task.comparison + task.limit).join('\n');
      limitedRefutation = 'この主張を資料の比較で反駁する。各資料が観測する段階を分け、単一資料に攻撃全体の結論を書かない。' + focus.limit;
      if (attackId === 'sql_injection') {
        questionFocus = 'Web記録の時刻・要求対象で調査対象を確認し、対応するDB監査のstatement（sql・query）欄に記録された実行SQLの条件式・演算子・引用符の範囲を読む。対象要求とSQLの識別情報で照合できる範囲を問う。Webの入力本文や通常要求の比較例は要求しない。';
        expectedInference = '対象要求とDB監査の識別情報を照合し、statement欄から入力によるSQL構造の改変と実行を確認する。特定の検索範囲・取得件数・データ流出は、この事実だけでは確定しない。';
        limitedRefutation = '保証されている入力によるSQL構造の改変・実行に基づいてclaimを反駁する。一つの値だけに一致する検索条件や特定の検索範囲を必須にしない。' + focus.limit;
      }
      if (attackId === 'clickfix') {
        questionFocus = '保存案内の要求ID・応答時刻・instruction_ref・求める操作と、今回の端末記録の端末ID・プロセス相関ID・instruction_ref・親子関係・実行ユーザー・起動結果を読み比べる。instruction_refによる内容対応と、要求ID・プロセス相関IDが識別する対象の違いを踏まえ、起動経路と検察側の攻撃目的・作成・直接起動の帰属を選ぶ4択。';
        expectedInference = '資料から確認できる事実は、保存案内が端末操作を求めていること、両資料に同じinstruction_refが記録されていること、案内に記載された操作内容に対応する処理がその後に端末で起動していることである。要求IDはWeb要求、プロセス相関IDは端末上の処理を識別する別の番号であり、両者を直接対応付ける値ではない。端末記録の実行ユーザー識別子は利用アカウントを示すが、処理の作成者や攻撃目的は示さない。事件内の人物設定では被告人はvictimに対応する利用者であり、この対応はログから人物を特定した結果ではない。保存案内から対応する処理が起動した経路は、被告人が攻撃処理を作成し、攻撃目的で直接起動したという検察側の説明とは両立しない。被告人が誘導に従って端末を操作したことや、処理が起動したこと自体は否定しない。';
        limitedRefutation = '保存案内と端末記録の同じinstruction_refにより確認できる内容対応と起動経路を根拠に、被告人が攻撃用処理を作成し、攻撃目的で直接起動したというclaimを反駁する。被告人の利用者としての端末操作や処理の起動自体は否定しない。要求IDとプロセス相関IDを同一視せず、実行ユーザー識別子から人物や意図を断定しない。';
        if (!incident) {
          claim = '案内の要求IDと端末のプロセス相関IDは、同じ処理を表す番号です。この二つの番号を照合すれば、案内と実行を対応付けられます。';
          questionFocus = '要求ID・プロセス相関IDがそれぞれ識別する対象と、instruction_refが示す案内内容・処理内容の対応を読み比べる4択。';
          expectedInference = focus.comparison + focus.limit;
        limitedRefutation = '要求IDとプロセス相関IDの同一視を反駁し、内容の対応はinstruction_refと時系列・起動結果から確認する。実行ユーザー識別子だけから作成者や操作者を特定しない。';
        }
      }
    }
    const incidentTask = completed.find(task => task.sources.includes('browser_request_initiator_record')
      || task.sources.includes('application_response_record'));
    if (incidentTask) {
      const stored = incidentTask.sources.includes('browser_request_initiator_record');
      questionFocus = '被害を起こした処理の開始元と、その処理が被告人の操作に見えた理由を、取得済み資料の識別情報と内容を比較して判断する。';
      if (!stored) questionFocus += 'DB監査のstatement欄でSQLの構造を読み、要求ID・クエリIDと返却資料を照合する。未記録のWebの入力本文は要求しない。';
      expectedInference = incidentTask.comparison;
      limitedRefutation = '被害が発生した事実と、攻撃入力から被害処理までの因果を裏付ける公開資料を示し、被告人が当該被害操作を直接行ったというclaimを反駁する。「意図は分からない」という一般論だけを結論にしない。人物の設定は観測で確認できる範囲と区別して示し、IP・アカウントだけから名前を特定しない。この攻撃の取得済み資料を本争点内で照合し、人物帰属だけの争点を追加しない。';
      if (!incidentTask.complete)
        limitedRefutation = '取得済み資料で要求・保存・実行・応答の対応を確認し、claimの記録解釈を反駁する。アカウントやIPの一致だけから作成者や操作者を特定しない。';
    }
    const credentialTask = completed.find(task => task.attackNodeId === stage.attackNodeId
      && task.sources.includes('credential_submission_record'));
    if (credentialTask) {
      expectedInference += ' 偽フォームへの送信・受信資料は、送信元ページ・送信先・相関識別子・処理結果が示す範囲を確認する。送信記録はフォームへの情報送信を示すが、フォームや受信先を準備した人物までは示さない。';
      limitedRefutation += ' 被告人が誘導に従って入力・送信したこと自体は否定せず、偽メール・偽フォームと受信先を準備し、資格情報を収集した主体だという主張を、準備と送信を区別して反駁する。';
    }
    if (grounds.some(ground => ground.sourceType === 'CASE_FACT')) fail(
      'PLAYER_CASE_REPORT_FORBIDDEN', `evidenceRequirements.requirements[${index}].grounds`,
      '内部用の直接観察記録・調査報告は、プレイヤー向けの争点資料にできません。');
    const learningDesign = tasks.map(task => task.complete
      ? `${task.name}: ${task.comparison} ${task.limit} この攻撃の必要資料をすべて取得済み。複数資料の照合を正答の必須条件にする。`
      : `${task.name}: 今回はgrounds内の資料の観測項目と記録範囲を読む。${task.limit} 未取得の資料は今回の解答に使わない。攻撃全体の比較は必要な資料がそろう後の段階で行う。`).join('\n');
    const materialPolicy = tasks.map(task => phishingStagePolicy(generationInput.technicalInput.attackGraph.nodes
      .find(node => node.nodeId === task.attackNodeId).attackDefinitionId, task.grounds)).filter(Boolean).join('\n');
    if (materialPolicy) {
      expectedInference += materialPolicy;
      limitedRefutation += 'URL不一致は必須ではない。扱う場合は公開本文内の比較結果に限定し、資料本文で確認できない事件事実を追加しない。';
    }
    return { requirementId: `requirement_stage_${index + 1}`, purpose: 'CONTRADICTION_PROOF',
      description: `第${index + 1}段階: ${stage.displayName}。investigationStageの主張は検察側調査官の証言であり、技術的事実とは区別する。groundsの観測資料だけをこの段階の4択・反駁に使う。今回の資料は観測資料ごとの取得要件に示された既存の取得元・操作で取得し、以前の資料は収集済みのものを使う。\n${learningDesign}\n終了後の解説に使う攻撃の仕組み・用語の背景：${buildQuestionBackground(stages, index, generationInput)} この背景は制作資料であり、問題文へコピーしない。プレイ中は検察側のclaimを争点ごとに固定し、資料を替えても変更しない。原文全体を検索・照合し、資料・証拠箇所・反論を学習者が判断する。攻撃名、読み方、正解の箇所は事前に説明しない。必要な基礎知識、実際の事件の経緯、原文の根拠、各選択肢の読み違いは終了後に丁寧な日本語で説明する。`,
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
    correctionHint: '攻撃ごとに分けた各調査先に一つのinvestigationStageを割り当て、その攻撃で現在・過去に取得した資料だけをgroundsへ指定してください。' });
  if (requirements.length !== stages.length) problem('調査対象数と段階別の争点数が一致しません。');
  const claims = new Map();
  for (const requirement of requirements) {
    const normalized = requirement.investigationStage.claim.normalize('NFKC').replace(/\s/g, '');
    const previous = claims.get(normalized);
    if (previous) problem(`${previous}と${requirement.investigationStage.targetId}の主張が同一です。各資料が記録する対象・処理に即した異なる争点にしてください。`);
    else claims.set(normalized, requirement.investigationStage.targetId);
  }
  stages.forEach((stage, index) => {
    const matches = requirements.filter(item => item.investigationStage.targetId === stage.targetId);
    if (matches.length !== 1) { problem(`${stage.targetId}の争点が一意に定義されていません。`); return; }
    const requirement = matches[0];
    const plan = requirement.investigationStage;
    if (plan.order !== index + 1 || plan.sourceNodeId !== stage.sourceNodeId
      || requirement.purpose !== 'CONTRADICTION_PROOF') problem(`${stage.targetId}の順序・取得元・用途が一致しません。`);
    if (hasSelfDisclosingShortcut(plan.claim)) {
      problem(`${stage.targetId}のclaimが、観測事実と結論を「だけで」で直結する不自然な表現になっています。`);
    }
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
    if (grounds.length !== requirement.grounds.length) problem(`${stage.targetId}が観測資料以外を反駁の根拠に指定しています。`);
    if (grounds.some(ground => ground.attackNodeId !== stage.attackNodeId)) problem(`${stage.targetId}に別の攻撃の争点資料が混在しています。`);
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
    const allowed = new Set(requirement.grounds.map(key));
    const outside = [...covered].filter(ref => !allowed.has(ref));
    const distinctSources = new Set(requirement.grounds.filter(ground => ground.sourceType === 'ATTACK_GRAPH_ARTIFACT')
      .map(ground => ground.sourceId));
    const problems = [];
    if (outside.length) problems.push({ code: 'INVESTIGATION_STAGE_EVIDENCE_SCOPE_MISMATCH',
      field: `evidenceSet.contradictions.${requirement.investigationStage.targetId}`,
      reason: `検証済みの第${index + 1}段階とは別の争点の資料が混在しています: ${outside.join(', ')}。`,
      correctionHint: '担当する攻撃の段階別Requirementに指定された取得済み資料で反駁してください。別攻撃の論証を最終争点に集めず、その攻撃の担当争点で示してください。' });
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
