import { EXTENDED_ATTACK_LEARNING } from './extended-attack-learning.js';
import { investigationSourceLabel, stageQuestionTasks } from './attack-learning.js';

// General terminology for composing questions, separate from case observations and answer keys.
// Never fill in event values, people, execution results or future evidence here.
const BASICS = Object.freeze({
  // 2026-09-24: mainの攻撃も同じ調査・法廷・判決の生成対象とする。
  ...Object.fromEntries(Object.entries(EXTENDED_ATTACK_LEARNING).map(([id, item]) => [id, item.basic])),
  phishing: 'フィッシングは、信用させる案内で偽のページなどへ誘導する手口です。',
  credential_phishing: '認証情報フィッシングは、偽の入力画面でアカウントの名前やパスワードを送らせる手口です。',
  stored_xss: 'Stored XSSは、サイトに保存された内容にスクリプトというブラウザへの命令が紛れ、後の閲覧時に動く手口です。',
  reflected_xss: 'Reflected XSSは、Webへの入力が返されたページに入り込み、ブラウザへの命令として動く手口です。',
  sql_injection: 'SQLインジェクションは、入力した文字がデータとして扱われず、データベースへの命令の組み立てに混ざる手口です。',
  unauthorized_login: '不正ログインは、他者のアカウントを無断で使ってサービスに入ることです。',
  clickfix: 'ClickFixは、「修復や本人確認に必要」と見せかけ、利用者自身に端末で操作させる手口です。',
  password_spray: 'パスワードスプレーは、少数のパスワード候補を多くのアカウントへ試す手口です。',
  ransomware: 'ランサムウェアは、ファイルを暗号化して使えなくし、復元と引換えに金銭などを求める不正プログラムです。',
  unrestricted_file_upload: 'アップロードは、手元のファイルをサービスへ送って保存する操作です。',
});

const READINGS = Object.freeze({
  file_operation_record: 'pidは端末内のプロセス番号、executableは実行ファイル、operationは操作種別です。同じ長さの時間帯を比較し、書込み・改名・作成の対象を確認します。PIDは再利用されるため、端末・時刻・process_refも照合します。',
  damaged_file_record: '拡張子は名前の一部であり内容の形式ではありません。detected_formatは検査した形式、sha256は内容のハッシュ、header_hexは先頭バイトの16進表記です。',
  original_file_record: '正常版は攻撃前の保全資料です。file_refと元の端末・パスで対応する被害側を探し、両方を読んでから形式・ハッシュ・先頭データを比較します。',
  ransom_note_record: '要求文のbodyは文書を書いた側の主張です。復旧と引換えの金銭要求を読み、ファイル操作や検査と照合します。',
  email_record: '保存メールは案内やリンクの内容を示す資料です。リンクの記載と実際のアクセス記録は別です。HTML資料を比較する場合、hrefはリンクが指定する行き先です。',
  web_access_record: '要求は、ブラウザなどがページを取り寄せるために送る連絡です。',
  stored_content_record: '投稿IDは保存された投稿を見分ける番号、保存内容は投稿の元の文字列です。',
  browser_execution_record: 'ブラウザの動作記録は、ページ表示に伴う処理を別途観測した資料です。',
  database_statement_record: 'SQLのSELECTは読み出す項目、WHEREは選ぶ条件を表します。',
  credential_submission_record: '送信先は情報を送った相手、相関IDは対応する処理を探す目印です。',
  authentication_record: 'accountはアカウント名、source_ipは接続元の住所、resultは成否です。',
  application_session_record: 'セッションの受入れはログイン状態が使えたかを、権限はできる操作の範囲を示します。',
  clickfix_page_record: '保存された案内は、画面で何をするよう求めたかを読む資料です。',
  // 2026-09-24 修正前: parent_refは起動元とだけ説明。
  // process_execution_record: 'プロセスは動いているプログラムの単位です。親子関係とは、あるプロセスが別のプロセスを起動する関係です。process_refはその識別子、parent_refは起動元、user_refは実行アカウント、start_resultは起動結果です。',
  // 2026-09-24 修正後: kawata-workの学習要件に合わせ親子関係と人物帰属の限界を説明。
  process_execution_record: 'プロセスは動いているプログラムの単位です。親子関係とは、あるプロセスが別のプロセスを起動する関係です。process_refとparent_refはプロセス相関IDと親の相関IDであり、OSのPIDとは区別します。pidとparent_pidが記録されていれば同じ端末・時刻・相関IDと合わせて親を追跡します。user_refは実行アカウント、start_resultは起動結果です。アカウントは実際の人物とは限りません。',
  spray_authentication_record: 'accountは試されたアカウント、source_ipは接続元、resultは成否です。',
  authentication_policy_record: '認証設定は、確認方法や試行制限の条件を記した資料です。',
  file_encryption_record: 'ハッシュはファイルの内容から計算する検査値です。',
  upload_receipt_record: 'Content-Typeは送り手が申告した種類で、内容検査の結果ではありません。',
  uploaded_file_record: '保存IDは受付資料との照合に使います。',
});

// Source vocabulary for writing a self-contained question, never a player-facing guide.
export function buildQuestionBackground(stages, index, generationInput) {
  const questionNodes = new Set(stageQuestionTasks(stages, index, generationInput).map(task => task.attackNodeId));
  const current = { ...stages[index], routes: stages[index].routes.filter(route => questionNodes.has(route.ground.attackNodeId)) };
  const introductions = [...new Set(current.routes.map(route => route.ground.attackNodeId))].map(nodeId => {
    const attackId = generationInput.technicalInput.attackGraph.nodes.find(node => node.nodeId === nodeId)?.attackDefinitionId;
    if (!BASICS[attackId]) throw new Error(`Missing question background: ${attackId}`);
    return BASICS[attackId];
  });
  const readings = [...new Set(current.routes.map(route => READINGS[route.ground.sourceId])
    .filter(Boolean))];
  const nodeIds = new Set(current.routes.map(route => route.ground.attackNodeId));
  const earlier = stages.slice(0, index).flatMap(stage => stage.routes)
    .filter(route => nodeIds.has(route.ground.attackNodeId));
  const sequence = earlier.length ? `これまでに取得した同じ攻撃の資料：${investigationSourceLabel(earlier)}。` : '';
  return [...introductions, ...readings, sequence].filter(Boolean).join(' ');
}
