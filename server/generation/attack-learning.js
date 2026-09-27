import { EXTENDED_ATTACK_LEARNING } from './extended-attack-learning.js';

// A configured teaching answer is not an additional fact in the attack graph.
export function phishingMaterialPolicy(attackId) {
  return ['phishing', 'credential_phishing'].includes(attackId)
    ? '宿題のURL比較は参考例であり、表示URLとhrefの不一致を必須にしない。email_recordのgroundが裏付ける保存メールの誘導内容・リンクと、Web記録の要求先を調べ、各資料で確認できる範囲を比較する。メールだけの段階では保存内容を問い、Web資料取得後に要求記録と比較する。専用の送受信計測がある攻撃ではその取得後に送受信を扱う。URL等の具体値は合成資料内の設定値であり、不一致を確認済みの技術的事実としては裏付けない。相違や対応を結論に使う場合は公開本文の値で示し、確認できない対応は未確認とする。既存の接続先・攻撃結果を変えず、クリック原因、ページ遷移の完了、HTTPリダイレクト、人物の操作を推定しない。'
    : '';
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
  if (sourceId === 'email_record') return '保存された誘導内容とリンクをpublicContentへ非実行の文字列で示す。表示URLとhrefの不一致や差出人比較を必須にしない。第1段階はこのメールだけで保存内容と実際のアクセスの違いを説明できるようにする。';
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
    comparison: '保存メールの誘導内容・リンクと、Web記録の要求対象・時刻を読む。メールに保存された案内と記録された要求を比較し、リンクによる誘導の特徴と各記録の観測範囲を説明する。確認できない対応は未確認とする。',
    limit: 'URLの一致だけでは、そのメールを原因とするクリック、操作者、認証情報の送信は証明できない。',
  },
  credential_phishing: {
    name: '認証情報フィッシング', sources: ['email_record', 'web_access_record', 'credential_submission_record'],
    comparison: 'メールの誘導リンク、Webの要求対象、専用計測の送信先・時刻・相関IDを照合する。リンクへのアクセスと偽フォームの送信・受信を別の段階として説明し、資料で確認できない対応は未確認とする。',
    limit: '秘密値を記録しない。偽フォームへの送受信は正規サービスでの認証成功や操作者の特定を意味しない。',
  },
  stored_xss: {
    name: 'Stored XSS', sources: ['stored_content_record', 'web_access_record', 'browser_execution_record'],
    comparison: '保存投稿の識別子と非実行ソース、後の閲覧要求、対応するブラウザ実行計測を照合する。サーバーに保存された内容が後の閲覧時にブラウザで解釈される特徴を説明する。',
    limit: '保存・閲覧要求だけでは実行成功は分からない。実行計測が示す対象に限定し、Cookie窃取など未入力の影響を追加しない。',
  },
  reflected_xss: {
    name: 'Reflected XSS', sources: ['web_access_record', 'browser_execution_record'],
    comparison: '要求対象と当該応答に対応するブラウザ実行計測を照合する。要求を契機とした応答のスクリプト実行と、サーバー上での処理を区別する。',
    limit: 'アクセス成功だけで実行を判断せず、保存投稿やセッション窃取を追加しない。',
  },
  sql_injection: {
    name: 'SQLインジェクション', sources: ['web_access_record', 'database_statement_record'],
    comparison: 'Web記録の時刻・要求対象で対象要求を確認し、その要求に対応するDB監査の実行SQLを読む。SQLのstatement欄（同義のsql・query欄も可）の条件式・演算子・引用符の範囲から、文字列の値と命令の構造を区別する。両資料で保証された対象要求と実行SQLの識別情報を照合し、Webへの要求の到達とDBでの実行を区別する。',
    limit: 'Web記録に入力値や本文が保存されるとは仮定しない。未記録の入力や通常要求の比較例、相関IDを追加しない。識別情報で対応を確認できない場合は未確認とし、時刻の近さだけで同一要求と断定しない。記録にないクエリ結果・流出件数・OS操作やDB権限の拡大を補完しない。SQLは実行せず文字列として読む。',
  },
  unauthorized_login: {
    name: '不正ログイン', sources: ['authentication_record', 'application_session_record'],
    comparison: '認証側のアカウント・送信元・時刻・成否と、Web側の認証連携・セッション受入れ・投稿権限を照合する。資格情報の受理、セッション利用、投稿完了を区別する。',
    limit: '認証成功だけから人物・正当な利用・投稿完了を導かない。資格情報を得た方法やMFA突破を未選択のまま追加しない。',
  },
  clickfix: {
    name: 'ClickFix', sources: ['clickfix_page_record', 'process_execution_record'],
    comparison: '保存された修復・本人確認の案内と端末計測の時刻・親子プロセス・実行ユーザー・起動結果を比較する。Web表示と利用者の端末操作を介したプロセス起動を区別する。',
    limit: '案内の応答だけでは実行を示さず、時刻の近さだけでも因果は確定しない。計測にないコマンド、人物、後続被害を作らない。',
  },
  password_spray: {
    name: 'パスワードスプレー', sources: ['spray_authentication_record', 'authentication_policy_record'],
    comparison: '認証試行をアカウント・時刻・送信元・成否で比較し、一つのアカウントへの集中か複数への分散かを読む。事件時の認証方式・制限の適用条件と照合する。少数候補を多数アカウントへ試す特徴と観測パターンを区別する。',
    limit: '秘密値を記録しない監査から同じパスワード候補を使ったことは確定できない。設定があるだけで全試行の遮断を主張しない。',
  },
  ransomware: {
    name: 'ランサムウェア', sources: ['process_execution_record', 'file_encryption_record'],
    comparison: 'プロセス起動とファイル検査の書込み処理の相関IDを照合する。対象パス・変更前後のハッシュ・暗号化確認結果・要求文から、起動、内容変更、暗号化による影響を区別する。',
    limit: '改名やハッシュ変化だけで暗号化と断定しない。確認したファイル以外の被害、情報流出、横展開を補完しない。',
  },
  unrestricted_file_upload: {
    name: '不正ファイルアップロード', sources: ['upload_receipt_record', 'uploaded_file_record'],
    comparison: '受付記録の申告ファイル名・Content-Type・受入れ結果と、同じ保存IDの内容検査・許可外判定・保存先設定を照合する。申告値を信頼する検証の限界と、内容検査の役割を説明する。',
    limit: '保存は実行を意味しない。非実行の保存領域をWebシェル実行へ変更せず、検査対象外のファイルや人物を補完しない。',
  },
});

const SOURCE_GUIDES = Object.freeze({
  email_record: ['メールのリンク情報', '本文の案内、表示URL、href（リンク先の指定）を読み比べましょう。'],
  web_access_record: ['Web要求', '要求対象と時刻を確認し、どのページへの要求が記録されたかを読みましょう。'],
  stored_content_record: ['保存投稿', '投稿の識別子・保存内容と閲覧対象の対応を調べましょう。'],
  browser_execution_record: ['ブラウザ計測', 'どの閲覧対象の実行を計測したか、保存資料や要求記録と照合しましょう。'],
  database_statement_record: ['DB監査', '対象要求に対応する実行SQLの識別情報と、記録されたSQLの条件・構造を確認しましょう。'],
  credential_submission_record: ['フォーム送受信', '送信先・時刻・相関IDを照合し、アクセスと送受信を分けて整理しましょう。'],
  authentication_record: ['認証監査', 'アカウント・時刻・成否を読み、認証時点で確認できる範囲を整理しましょう。'],
  application_session_record: ['セッション監査', '認証の受理、セッション受入れ、利用できる権限を分けて調べましょう。'],
  clickfix_page_record: ['保存された案内', '案内が何を理由に、どこでの操作を求めているかを調べましょう。'],
  process_execution_record: ['プロセス計測', '端末・親子関係・実行ユーザー・起動結果を読み、どの処理を計測したか確認しましょう。'],
  spray_authentication_record: ['認証試行の分布', 'アカウントごとの試行、時刻、送信元、成否を比べて分布を読みましょう。'],
  authentication_policy_record: ['事件時の認証設定', '設定の適用時刻・対象・制限条件を読みましょう。'],
  file_encryption_record: ['ファイルの前後検査', '処理の相関ID、対象パス、前後の検査値、暗号化確認結果を照合しましょう。'],
  upload_receipt_record: ['アップロード受付', '申告名・Content-Type・受入れ結果・保存IDを確認しましょう。'],
  uploaded_file_record: ['保存ファイル検査', '保存IDで受付資料を探し、申告値と内容検査・保存先設定を照合しましょう。'],
});

export function investigationReadingGuide(routes) {
  return [...new Set(routes.map(route => SOURCE_GUIDES[route.ground.sourceId]?.[1]).filter(Boolean))].join('\n');
}

export function investigationSourceLabel(routes) {
  return [...new Set(routes.map(route => (SOURCE_GUIDES[route.ground.sourceId]?.[0] ?? route.sourceLabel)).filter(Boolean))].join('・');
}

export function stageLearningTasks(stages, index, generationInput) {
  const available = stages.slice(0, index + 1).flatMap(stage => stage.routes.map(route => route.ground));
  const current = stages[index].routes.map(route => route.ground);
  return [...new Set(current.map(ground => ground.attackNodeId))].map(attackNodeId => {
    const node = generationInput.technicalInput.attackGraph.nodes.find(item => item.nodeId === attackNodeId);
    const profile = ATTACK_LEARNING[node?.attackDefinitionId];
    if (!profile) throw new Error(`Missing learning contract: ${node?.attackDefinitionId}`);
    const grounds = available.filter(ground => ground.attackNodeId === attackNodeId);
    const complete = profile.sources.every(id => grounds.some(ground => ground.sourceId === id));
    return { attackNodeId, ...profile, grounds, complete };
  });
}

// A shared host can contain early records of another attack. Its full comparison
// belongs to the stage where its own sources are all available, not this question.
export function stageQuestionTasks(stages, index, generationInput) {
  const tasks = stageLearningTasks(stages, index, generationInput);
  const completed = tasks.filter(task => task.complete);
  return completed.length ? completed : tasks;
}
