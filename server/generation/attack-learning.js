import { EXTENDED_ATTACK_LEARNING } from './extended-attack-learning.js';
import { incidentProfile } from './incident-design.js';

// A configured teaching answer is not an additional fact in the attack graph.
export function phishingMaterialPolicy(attackId) {
  return ['phishing', 'credential_phishing'].includes(attackId)
    ? '宿題のURL比較は参考例であり、表示URLとhrefの不一致を必須にしない。email_recordのgroundが裏付ける保存メールの誘導内容・リンクと、Web記録の要求先を調べ、各資料で確認できる範囲を比較する。メールだけの段階では保存内容を問い、Web資料取得後に要求記録と比較する。専用の送受信記録がある攻撃ではその取得後に送受信を扱う。URL等の具体値は合成資料内の設定値である。因果の結論に使うリンク先と要求対象は公開本文の値で一致を示し、一致を示せない資料は合格させない。既存の接続先・攻撃結果を変えず、HTTPリダイレクトや記録範囲外の人物操作を推定しない。'
    : '';
}

// The whole-case acquisition policy is not an inference available at every
// stage. Only describe comparisons whose sources have already been acquired.
export function phishingStagePolicy(attackId, grounds) {
  if (!['phishing', 'credential_phishing'].includes(attackId)) return '';
  const has = sourceId => grounds.some(ground => ground.sourceId === sourceId);
  if (!has('web_access_record')) return '保存メールに記載された案内・表示URL・リンク先を確認する。表示URLとリンク先の不一致は必須ではない。この資料から実際のアクセスや送受信の有無は判断しない。';
  return '保存メールのリンク先とWeb要求の対象を、取得済み資料に記載された値で照合する。表示URLとリンク先の不一致は必須ではない。リンク先と要求対象の対応を結論に使う場合は、本文の値の一致を示す。要求記録をページ遷移完了や操作人物の証明にしない。'
    + (has('credential_submission_record') ? '偽フォームへの送受信は専用記録の送信先・時刻・非秘密の相関IDで確認し、正規サービスでの認証成功と区別する。' : '未取得の送受信記録を今回の結論に使わない。');
}

export function scenarioInvestigationGoal(attack) {
  if (attack.attackId === 'credential_phishing' && attack.evidenceAnswer.includes('表示URLと実際のhrefが異なり'))
    return '保存メールの誘導リンクとWeb要求、偽フォームへの送信記録を確認する。送信記録と正規サービスでの認証成功を区別する。';
  return attack.attackId === 'phishing' && attack.evidenceAnswer.includes('実際に遷移するリンク先')
    ? '保存メールに記載された誘導内容・リンクとWeb記録の要求先を確認し、記録が示す範囲を比較する。ページ遷移の完了は到達目標にしない。'
    : attack.evidenceAnswer;
}

export function phishingObservationRequirement(attackId, sourceId) {
  if (!['phishing', 'credential_phishing'].includes(attackId)) return '';
  if (sourceId === 'email_record') return '保存された誘導内容とリンクをpublicContentへ非実行の文字列で示す。表示URLとhrefの不一致や差出人比較を必須にしない。メールのみを取得する段階では、このメールだけで保存内容と実際のアクセスの違いを説明できるようにする。';
  if (sourceId === 'web_access_record') return '取得定義の記録時刻と要求先をJSON Linesの対象行に示す（例：timestampとrequest_target）。取得後にメールと要求記録の観測範囲を比較する。メールとの対応は記録された範囲で判断し、要求記録をページ遷移完了の証拠にしない。';
  return '';
}
// Teaching contracts describe how to read existing observations, never new incident facts.
// Source IDs below are the catalog's observableArtifacts. Availability is checked by the graph.
export const ATTACK_LEARNING = Object.freeze({
  // 2026-09-24: mainの攻撃も同じ調査・法廷・判決の生成対象とする。
  ...EXTENDED_ATTACK_LEARNING,
  phishing: {
    name: 'フィッシング', sources: ['email_record', 'web_access_record'],
    comparison: '保存メールの誘導内容・実際のリンク先と、Web記録の要求対象・時刻を照合する。ホストを含む宛先の一致から同じ宛先への要求であることを確認する。メールを原因とするクリックや作成者の人物は、この一致だけでは確定しない。',
    limit: 'URLの一致だけでは、そのメールを原因とするクリック、操作者、認証情報の送信は証明できない。',
  },
  credential_phishing: {
    name: '認証情報フィッシング', sources: ['email_record', 'web_access_record', 'credential_submission_record'],
    comparison: 'メールの誘導リンク、Webの要求対象、専用記録の送信先・時刻・相関IDを照合する。公開本文に記録されたリンク先と要求対象の一致を確認し、リンクへのアクセスと偽フォームの送信・受信を別の段階として説明する。',
    limit: '秘密値を記録しない。偽フォームへの送受信は正規サービスでの認証成功や操作者の特定を意味しない。',
  },
  stored_xss: {
    name: 'Stored XSS', sources: ['stored_content_record', 'web_access_record', 'browser_execution_record'],
    comparison: '保存投稿の識別子と非実行ソース、後の閲覧要求、対応するブラウザのスクリプト実行記録を照合する。保存・閲覧要求だけでは実行成功は分からないため、対応する実行記録によって、サーバーに保存された内容が後の閲覧時にブラウザで解釈された経路を確認する。',
    limit: '保存・閲覧要求だけでは実行成功は分からない。実行記録が示す対象に限定し、Cookie窃取など未入力の影響を追加しない。',
  },
  reflected_xss: {
    name: 'Reflected XSS', sources: ['web_access_record', 'browser_execution_record'],
    comparison: '要求対象と当該応答に対応するブラウザのスクリプト実行記録を照合する。要求を契機とした応答のスクリプト実行と、サーバー上での処理を区別する。',
    limit: 'アクセス成功だけで実行を判断せず、保存投稿やセッション窃取を追加しない。',
  },
  sql_injection: {
    name: 'SQLインジェクション', sources: ['web_access_record', 'database_statement_record'],
    comparison: 'Web記録の時刻・要求対象で対象要求を確認し、その要求に対応するDB監査の実行SQLを読む。SQLのstatement欄（同義のsql・query欄も可）の条件式・演算子・引用符の範囲から、文字列の値と命令の構造を区別する。両資料で保証された対象要求と実行SQLの識別情報を照合し、Webへの要求の到達とDBでの実行を区別する。',
    limit: 'Web記録に入力値や本文が保存されるとは仮定しない。未記録の入力や通常要求の比較例、相関IDを追加しない。識別情報で対応を確認できない場合は未確認とし、時刻の近さだけで同一要求と断定しない。記録にないクエリ結果・流出件数・OS操作やDB権限の拡大を補完しない。SQLは実行せず文字列として読む。',
  },
  unauthorized_login: {
    name: '不正ログイン', sources: ['authentication_record', 'application_session_record'],
    comparison: '認証サービス側のアカウント・送信元・時刻・成否と、Webアプリケーション側の認証連携・セッション確立・投稿権限を照合する。認証成功、セッション利用、投稿完了を区別する。',
    limit: '認証成功だけから人物・正当な利用・投稿完了を導かない。資格情報を得た方法やMFA突破を未選択のまま追加しない。',
  },
  clickfix: {
    name: 'ClickFix', sources: ['clickfix_page_record', 'process_execution_record'],
    comparison: '保存案内と端末記録に記録された同じinstruction_refを照合し、案内に記載された非実行の操作識別子と、起動した処理内容の対応を確認する。案内の応答時刻、端末での起動時刻、親子プロセス、実行ユーザー、起動結果を読み、Web表示と利用者の端末操作を介したプロセス起動を区別する。',
    limit: 'instruction_refの一致は案内内容と記録された処理内容の対応を示すが、要求IDとプロセス相関IDを同一の番号にはしない。案内の応答や時刻の近さだけでは実行を示さず、実行ユーザー識別子から人物や攻撃目的を断定しない。記録にないコマンドや後続被害を作らない。',
  },
  password_spray: {
    name: 'パスワードスプレー', sources: ['spray_authentication_record', 'authentication_policy_record'],
    comparison: '認証試行をアカウント・時刻・送信元・成否で比較し、一つのアカウントへの集中か複数への分散かを読む。事件時の認証方式・制限の適用条件と照合する。少数候補を多数アカウントへ試す特徴と観測パターンを区別する。',
    limit: '秘密値を記録しない監査から同じパスワード候補を使ったことは確定できない。設定があるだけで全試行の遮断を主張しない。',
  },
  ransomware: {
    name: 'ランサムウェア', sources: ['file_operation_record', 'process_execution_record', 'damaged_file_record', 'original_file_record', 'ransom_note_record'],
    comparison: '被害時間帯のファイル操作をPID・実行ファイル・操作種別で比較し、書込み・共通拡張子への改名・要求文作成を時系列で読む。同じ端末のプロセス相関IDとPIDから実行アカウント・実行ファイル・親PIDを調べ、記録された親子関係をたどる。同じfile_refの被害ファイルと正常版について形式・ハッシュ・先頭データを比較し、使用不能化と復旧への金銭要求を合わせ、ランサムウェア被害の可能性が非常に高いと判断する。',
    limit: '改名・ハッシュ差・形式不明だけで暗号化と断定しない。アカウント利用は本人の操作や意図を証明しない。SSHは検証済み経路と認証記録がある場合のみ扱い、ClickFix等の前段を置き換えない。対象外被害・情報流出・横展開は補完しない。',
  },
  unrestricted_file_upload: {
    name: '不正ファイルアップロード', sources: ['upload_receipt_record', 'uploaded_file_record'],
    comparison: '受付記録の送信元識別子・要求ID・申告ファイル名・Content-Type・受け入れ結果と、同じ保存IDの内容検査・許可外判定・保存先設定を照合する。外部から受け付けた要求がアプリケーションの保存処理へ渡った経路と、申告値を信頼する検証の限界を説明する。',
    limit: '保存は実行を意味しない。送信元識別子は技術上の送信元を区別する値であり、人物の氏名を示さない。非実行の保存領域をWebシェル実行へ変更せず、検査対象外のファイルや人物を補完しない。',
  },
});

const SOURCE_GUIDES = Object.freeze({
  ssh_authentication_record: ['SSH認証記録', '認証の結果と、接続後のシェル起動・実効権限を分けて確認します。'],
  ssh_session_record: ['SSH接続後のシェル起動記録', '認証記録との対応と、実際に起動したシェルの権限を確認します。'],
  traversal_access_record: ['ファイル参照要求の記録', '要求された対象と、読み取り処理の結果を分けて確認します。'],
  traversal_read_record: ['ファイルの読み取り応答記録', '要求対象と実際に返されたファイルの対応を確認します。'],
  sudo_policy_record: ['sudo許可設定', '許可された主体・コマンド・適用条件を確認します。'],
  sudo_execution_record: ['sudoによる処理の起動記録', '適用された許可設定と実行時の実効UIDを照合します。'],
  setuid_metadata_record: ['実行ファイルの所有者・setuid属性', '属性の設定と実際の実行結果を区別します。'],
  setuid_execution_record: ['setuid実行ファイルの起動記録', '対象ファイルと実行時の実効UIDを照合します。'],
  service_acl_record: ['サービス実行ファイルの権限設定', '実行パスと書き換え権限、サービスの実行アカウントを確認します。'],
  service_execution_record: ['サービスの再起動・実行記録', '対象サービスの再起動と実際の実行主体を確認します。'],
  collection_read_record: ['保護ファイルの読み取り記録', '対象プロセスと読み取ったファイルの範囲を確認します。'],
  collection_output_record: ['収集物の検査記録', '読み取り対象と収集物の対応を確認し、外部送信とは区別します。'],
  file_operation_record: ['ファイル操作ログ', '被害時間帯の操作をPID・実行ファイル・操作種別で比較し、対象パスと操作の順序を調べましょう。'],
  damaged_file_record: ['被害ファイル', '実際の形式・ハッシュ・先頭データを確認しましょう。正常版との比較は両方を調べてから行います。'],
  original_file_record: ['バックアップの元ファイル', '元の対象を示す識別子と形式・ハッシュ・先頭データを確認しましょう。'],
  ransom_note_record: ['身代金要求文', '保存本文に何が要求されているかを読み、文書の主張と技術記録を区別しましょう。'],
  announcement_audit_record: ['告知投稿の監査記録', '投稿要求の識別子と処理結果を、要求の開始元の記録と照合しましょう。'],
  browser_request_initiator_record: ['ブラウザ通信の開始元記録', 'どのスクリプトから通信が発生したか、保存投稿・実行・投稿要求の識別子を確認しましょう。'],
  application_response_record: ['Web応答の監査記録', '要求・クエリの識別子と返却レコードの対応を、Web・DBの記録と照合しましょう。'],
  email_record: ['メールのリンク情報', '本文の案内、表示URL、href（リンク先の指定）を読み比べましょう。'],
  web_access_record: ['Web要求', '要求対象と時刻を確認し、どのページへの要求が記録されたかを読みましょう。'],
  stored_content_record: ['保存投稿', '投稿の識別子・保存内容と閲覧対象の対応を調べましょう。'],
  browser_execution_record: ['ブラウザの動作記録', 'どの閲覧対象の実行を記録したか、保存資料や要求記録と照合しましょう。'],
  database_statement_record: ['DB監査', '対象要求に対応する実行SQLの識別情報と、記録されたSQLの条件・構造を確認しましょう。'],
  credential_submission_record: ['フォーム送受信', '送信先・時刻・相関IDを照合し、アクセスと送受信を分けて整理しましょう。'],
  authentication_record: ['認証監査', 'アカウント・時刻・成否を読み、認証時点で確認できる範囲を整理しましょう。'],
  application_session_record: ['セッション監査', '認証成功、セッション確立、そのセッションに付与された権限を分けて調べましょう。'],
  clickfix_page_record: ['保存された案内', '案内が何を理由に、どこでの操作を求めているか、非実行の操作識別子instruction_refとともに調べましょう。'],
  process_execution_record: ['プロセス記録', '端末・親子関係・実行ユーザー・起動結果・instruction_refを読み、どの処理を記録したか確認しましょう。'],
  spray_authentication_record: ['認証試行の分布', 'アカウントごとの試行、時刻、送信元、成否を比べて分布を読みましょう。'],
  authentication_policy_record: ['事件時の認証設定', '設定の適用時刻・対象・制限条件を読みましょう。'],
  file_encryption_record: ['ファイルの前後検査', '処理の相関ID、対象パス、前後の検査値、暗号化確認結果を照合しましょう。'],
  upload_receipt_record: ['アップロード受付', '送信元識別子・要求ID・申告名・Content-Type・受け入れ結果・保存IDを確認しましょう。'],
  uploaded_file_record: ['保存ファイル検査', '保存IDで受付資料を探し、申告値と内容検査・保存先設定を照合しましょう。'],
});

export function investigationReadingGuide(routes) {
  return [...new Set(routes.map(route => SOURCE_GUIDES[route.ground.sourceId]?.[1]).filter(Boolean))].join('\n');
}

export function investigationSourceLabel(routes) {
  return [...new Set(routes.map(route => (SOURCE_GUIDES[route.ground.sourceId]?.[0] ?? route.sourceLabel)).filter(Boolean))].join('・');
}

export function learningProfile(node, definitions = []) {
  const profile = ATTACK_LEARNING[node?.attackDefinitionId];
  const incident = incidentProfile(definitions, node?.attackDefinitionId);
  if (!incident || !node.effects.some(effect => effect.predicate === incident.impactEffectPredicate)) return profile;
  // The incident narrative is the pre-established case truth, not an observation.
  // Keep its required sources, but derive the player's inference from the
  // attack-specific comparison contract so the answer never quotes private truth
  // as though it had been proved by a log.
  let comparison = profile.comparison;
  if (incident.requiredArtifactIds.includes('application_response_record')) comparison +=
    ' Web要求・DB監査・応答監査の同じrequest_idとquery_idの組を照合し、SQL構造の改変、対象レコードの参照またはダイジェスト、成功応答による返却までを確認する。DB実行だけを返却の証明にしない。';
  if (incident.requiredArtifactIds.includes('browser_request_initiator_record')) comparison +=
    ' さらに出典投稿ID・閲覧要求ID・実行ID・通信開始元のソース位置・投稿要求ID・告知受理結果を照合し、手動送信ではなく保存スクリプトから告知投稿が発生した経路を確認する。';
  return { ...profile, comparison, sources: [...incident.requiredArtifactIds],
    limit: `${profile.limit} 事件内の人物設定と、資料から確認できる技術的事実を分ける。IP・アカウント記録だけで人物を特定しない。` };
}

export function stageLearningTasks(stages, index, generationInput) {
  const available = stages.slice(0, index + 1).flatMap(stage => stage.routes.map(route => route.ground));
  const stage = stages[index];
  const current = stage.routes.filter(route => route.ground.sourceType === 'ATTACK_GRAPH_ARTIFACT');
  const owners = stage.attackNodeId ? [stage.attackNodeId] : [...new Set(current.map(route => route.ground.attackNodeId))];
  return owners.map(attackNodeId => {
    const node = generationInput.technicalInput.attackGraph.nodes.find(item => item.nodeId === attackNodeId);
    const profile = learningProfile(node, generationInput.technicalInput.attackDefinitions);
    if (!profile) throw new Error(`Missing learning contract: ${node?.attackDefinitionId}`);
    const grounds = available.filter(ground => ground.attackNodeId === attackNodeId);
    const complete = profile.sources.every(id => grounds.some(ground => ground.sourceId === id));
    return { attackNodeId, ...profile, grounds, complete };
  });
}

// Ownership is established by acquisition planning, not by whichever case
// reports happen to be available. A shared host has separate attack-specific
// stages, and each comparison uses only current or earlier sources.
export function stageQuestionTasks(stages, index, generationInput) {
  return stageLearningTasks(stages, index, generationInput);
}
