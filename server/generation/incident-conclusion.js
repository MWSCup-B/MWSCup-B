import { EXTENDED_ATTACK_LEARNING } from './extended-attack-learning.js';
import { fail } from './schema.js';
import { buildIncidentNarratives } from './incident-design.js';

// These explanations track the catalog's satisfied prerequisites and effects.
// They summarize the verified case, not a deduction of private facts from logs.
const EVENTS = Object.freeze({
  // 2026-09-24: mainの攻撃も同じ調査・法廷・判決の生成対象とする。
  ...Object.fromEntries(Object.entries(EXTENDED_ATTACK_LEARNING).map(([id, item]) => [id, item.conclusion])),
  phishing: 'フィッシングでは、欺く案内メールのリンクから対象ページが開かれました。成立の要因は、メールが届くだけでなく、利用者がリンクを開いたことです。メールの行き先とWeb要求を比べて誘導先を調べましたが、一致だけでクリックした人物までは分かりません。',
  credential_phishing: '認証情報フィッシングでは、メールから偽フォームへ誘導され、入力・送信された認証情報が攻撃側に渡りました。原因は、情報を正規の認証先ではなく偽フォームへ送ったことです。メール、Web要求、フォームの送受信を比べ、閲覧と情報送信を区別しました。',
  clickfix: 'ClickFixでは、修復や本人確認を装う画面の案内に従った端末操作から、一般利用者の権限で不審な処理が起動しました。原因は、案内への信頼を利用して端末で操作させたことです。ページを見ただけで自動実行されたわけではなく、保存案内と端末計測を分けて調べました。',
  password_spray: 'パスワードスプレーでは、多数のアカウントへ少数候補を試し、有効な認証情報が得られました。本件の成功条件は、候補の一致、パスワードだけの認証、対象試行が遮断されなかったことです。試行分布と当時の設定を照合しましたが、秘密値を残さない監査だけで同一候補の使用は証明できません。',
  unauthorized_login: '不正ログインでは、有効な認証情報が無断で使われ、対象アカウントのセッションが成立しました。本件はパスワードだけで認証され、そのアカウントの投稿権限が利用できる環境でした。認証資料とセッション資料を比べ、認証の受理と利用権限を区別しました。',
  stored_xss: '【Stored XSS（蓄積型クロスサイトスクリプティング）】\nWebサイトに保存された内容が、後でページを見た人のブラウザで命令として解釈される攻撃です。スクリプトとは、ブラウザなどに処理を指示するプログラムです。本件では、不正な投稿が保存され、その後の閲覧時にブラウザで実行されました。投稿内容を表示する際の処理が不適切で、命令としての解釈・実行を防げなかったことが原因です。\n調査では、保存投稿の識別子と内容、Webの閲覧要求、対応するブラウザのスクリプト実行記録を順に比較します。投稿が保存された記録は「保存」、アクセス記録は「要求」を示します。どちらも単独では実行成功の証拠にはならず、実行の有無は対応する計測で確かめます。実行できたとしても、資料にない情報の窃取や、操作した人物まで証明したことにはなりません。',
  reflected_xss: 'Reflected XSSでは、要求の入力が応答ページへ入り込み、ブラウザで命令が動きました。原因は、入力を安全な表示用の文字に処理せず応答へ反映し、実行も阻止されなかったことです。Web要求とブラウザの動作記録を照合し、要求の到達とブラウザでの実行を区別しました。',
  sql_injection: '【SQLインジェクション】\nSQLは、データベースに検索や更新を指示する言語です。入力を検索する値として安全に扱わず命令文へ組み込むと、入力によって命令の条件や構造が変わることがあります。本件では、そのように変更されたSQLが、Webアプリケーションの接続に使われるDB権限の範囲で実行されました。\n調査では、Web記録の時刻と要求対象で調べる要求を確認し、対応するDB監査のSQLを読みます。SELECTは取得する項目、FROMは対象の表、WHEREは行を選ぶ条件を指定します。文字列を囲む引用符と、その外側の条件式を区別し、AND・ORなどで条件がどう結び付いているかを確かめます。単に特定の文字があるだけで攻撃とは判定しません。\nWebへの要求とDBでの実行は別の段階です。Webログに入力本文が残っていなければ、その内容は復元できません。記録された識別情報で対応を確認し、時刻の近さだけで結び付けないことも大切です。SQLの実行だけで、情報流出の件数、DB管理者権限の取得、OS上の命令実行、実際の操作者まで分かったことにはなりません。',
  ransomware: 'ランサムウェアでは、端末で起動した処理が書込み可能な対象ファイルを暗号化し、金銭を求める文面を残しました。調査では、短時間の書込み・改名・文書作成、被害ファイルと正常版の形式・ハッシュ・先頭データ、復旧への金銭要求を組み合わせます。これらはランサムウェア被害の可能性が非常に高いことを示しますが、ハッシュ差や形式不明だけで暗号化方式は確定しません。記録された親子プロセスをたどって実行経路を調べ、アカウントの利用と本人の操作・意図は区別します。',
  unrestricted_file_upload: '不正ファイルアップロードでは、許可外の内容が受け入れられ、保存されました。原因は、形式や内容の検査が不十分だったことです。受付時の申告と同じ保存IDの内容検査を比べ、申告された種類をそのまま実物の種類と扱えないことを確かめました。本件の保存先は非実行で、保存成功はコード実行を意味しません。',
});

const LINKS = Object.freeze({
  'phishing:clickfix': 'メールの誘導先が、この偽案内でした。',
  'clickfix:ransomware': 'この暗号化の足がかりは、ClickFixによる端末実行です。',
  'credential_phishing:unauthorized_login': '悪用された認証情報は、前段の偽フォームで取得されたものです。',
  'password_spray:unauthorized_login': '悪用された認証情報は、前段の試行で有効と分かったものです。',
  'unauthorized_login:stored_xss': '投稿には、不正ログインで得た権限が使われました。',
  'phishing:stored_xss': '保存済みページの閲覧は、メールの誘導につながっています。',
  'credential_phishing:stored_xss': '保存済みページの閲覧は、メールの誘導につながっています。',
  'phishing:reflected_xss': 'このページへの要求には、メールの誘導がつながっています。',
});

export function buildIncidentConclusion(configuration, generationInput) {
  const graph = generationInput.technicalInput.attackGraph;
  const attacks = [...configuration.attacks].sort((a, b) => a.order - b.order);
  const selectedNodes = attacks.map(attack => graph.nodes.find(node => node.attackDefinitionId === attack.attackId));
  if (selectedNodes.some(node => !node || node.state !== 'SATISFIED' || !EVENTS[node.attackDefinitionId])) {
    fail('INCIDENT_CONCLUSION_UNVERIFIED', 'technicalInput.attackGraph', '判決の事件解説には選択された全攻撃の成立確認が必要です。');
  }
  const paragraphs = selectedNodes.map(node => {
    const links = selectedNodes.filter(previous => graph.edges.some(edge => edge.type === 'ENABLES'
      && edge.from === previous.nodeId && edge.to === node.nodeId))
      .map(previous => LINKS[`${previous.attackDefinitionId}:${node.attackDefinitionId}`]).filter(Boolean);
    return EVENTS[node.attackDefinitionId] + [...new Set(links)].join('');
  });
  const incidents = buildIncidentNarratives(configuration, graph);
  if (incidents.length) return paragraphs.join('\n\n') + '\n\n本件の被害と発生原因\n'
    + incidents.map(item => `${item.impact}\n${item.causalRefutation}`).join('\n\n')
    + '\n\n取得した資料を対応付けた結果、被告人に帰属させられた被害操作は、別の攻撃主体が投入した内容から生じた処理であると確認しました。被告人を当該攻撃の実行者とする検察側の説明は、この発生経路と矛盾するため、無罪とします。攻撃主体と被告人の役割は事件内の設定であり、IPやアカウントの記録だけから実在の人物を特定したものではありません。';
  return paragraphs.join('\n\n') + '\n\n'
    + '以上の経緯と、資料で確認できる範囲は区別が必要です。検察側が主張した被告人本人の操作を結び付ける裏付けは足りず、記録上のアカウントや端末だけで人物を断定できません。合理的な疑いが残るため、無罪と判断します。';
}
