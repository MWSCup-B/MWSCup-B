import { EXTENDED_ATTACK_LEARNING } from './extended-attack-learning.js';
import { fail } from './schema.js';
import { buildIncidentNarratives } from './incident-design.js';

// These explanations track the catalog's satisfied prerequisites and effects.
// They summarize the verified case, not a deduction of private facts from logs.
const EVENTS = Object.freeze({
  // 2026-09-24: mainの攻撃も同じ調査・法廷・判決の生成対象とする。
  ...Object.fromEntries(Object.entries(EXTENDED_ATTACK_LEARNING).map(([id, item]) => [id, item.conclusion])),
  phishing: 'フィッシングでは、欺く案内メールのリンクから対象ページが開かれました。成立の要因は、メールが届くだけでなく、利用者がリンクを開いたことです。メールの行き先とWeb要求を比べて誘導先を調べましたが、一致だけでクリックした人物までは分かりません。',
  credential_phishing: '認証情報フィッシングでは、メールから偽フォームへ誘導され、入力・送信された認証情報が攻撃者に渡りました。原因は、情報が正規の認証先ではなく偽フォームへ送られたことです。メール、Web要求、フォームの送受信記録を比較し、ページへのアクセスと情報の送信を区別しました。',
  clickfix: 'ClickFixでは、利用者が修復や本人確認を装う画面の案内に従って端末を操作した結果、一般利用者の権限で不審な処理が起動しました。原因は、利用者に案内を信用させ、端末上の操作へ誘導したことです。ページを見ただけで自動実行されたわけではないため、保存された案内と端末の動作記録を分けて調べました。',
  password_spray: 'パスワードスプレーでは、少数のパスワード候補が多数のアカウントに対して試され、そのうち一つで認証に成功しました。本件の成立条件は、候補の一致、パスワードだけを使う認証方式、対象の試行が遮断されなかったことです。試行の分布と事件当時の設定を照合しましたが、秘密値を残さない監査記録だけでは、各試行で同じ候補が使われたことまでは証明できません。',
  unauthorized_login: '不正ログインでは、有効な認証情報が無断で使われ、対象アカウントで認証されたセッションが成立しました。本件ではパスワードだけで認証でき、そのアカウントには投稿権限が付与されていました。認証記録とセッション監査を比較し、認証成功、セッション確立、そのセッションに付与された権限を区別しました。',
  stored_xss: '【Stored XSS（蓄積型クロスサイトスクリプティング）】\nWebサイトに保存された内容が、後でページを閲覧した利用者のブラウザ上でスクリプトとして実行される攻撃です。スクリプトとは、ブラウザなどに処理を指示するプログラムです。本件では、スクリプトを含む投稿が保存され、その後の閲覧時にブラウザ上で実行されました。投稿内容を表示する際の処理が不適切で、スクリプトとしての解釈と実行を防げなかったことが原因です。\n調査では、保存投稿の識別子と内容、Webの閲覧要求、対応するブラウザのスクリプト実行記録を順に比較します。投稿の保存記録は内容が「保存されたこと」を、アクセス記録は閲覧対象への「要求が届いたこと」を示します。どちらも単独ではスクリプトの実行成功を示さないため、実行の有無はブラウザ側の記録で確かめます。実行が確認できても、資料に記録されていない情報の窃取や、実際にブラウザを操作した人物まで証明したことにはなりません。',
  reflected_xss: 'Reflected XSSでは、要求の入力が応答ページへ入り込み、ブラウザで命令が動きました。原因は、入力を安全な表示用の文字に処理せず応答へ反映し、実行も阻止されなかったことです。Web要求とブラウザの動作記録を照合し、要求の到達とブラウザでの実行を区別しました。',
  sql_injection: '【SQLインジェクション】\nSQLは、データベースに検索や更新を指示する言語です。入力を検索値として安全に扱わずSQL文へ組み込むと、その入力によってSQLの条件や構造が変わることがあります。本件では、このように構造が変化したSQLが、Webアプリケーションに割り当てられたDB接続用アカウントの権限で実行されました。\n調査では、Webアクセス記録を時刻と要求対象で絞り込み、調査対象の要求を特定してから、対応するDB監査記録のSQLを読みます。SELECT句は取得する項目、FROM句は対象の表、WHERE句は行を選ぶ条件を指定します。文字列を囲む引用符と、その外側にある条件式を区別し、ANDやORなどの演算子で条件がどのように結び付いているかを確かめます。特定の文字列が含まれているという理由だけで、SQLインジェクションとは判定しません。\nWebアプリケーションへの要求と、データベースでのSQL実行は別の処理段階です。Webアクセス記録に入力本文が残っていなければ、その内容は復元できません。資料に記録された識別情報を使って対応を確認し、時刻が近いという理由だけで同じ処理だと判断しないことも重要です。また、SQLの実行記録だけから、流出した情報の件数、DB管理者権限の取得、OS上での命令実行、実際の操作者まで分かるわけではありません。',
  ransomware: 'ランサムウェアでは、端末で起動した処理が書き込み可能な対象ファイルを暗号化し、金銭を求める文面を残しました。調査では、短時間の書き込み・改名・文書作成、被害ファイルと正常版の形式・ハッシュ・先頭データ、復旧への金銭要求を組み合わせます。これらはランサムウェア被害の可能性が非常に高いことを示しますが、ハッシュ差や形式不明だけで暗号化方式は確定しません。記録された親子プロセスをたどって実行経路を調べ、アカウントの利用と本人の操作・意図は区別します。',
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
  const incidents = buildIncidentNarratives(configuration, graph,
    generationInput.technicalInput.attackDefinitions);
  if (incidents.length) return paragraphs.join('\n\n') + '\n\n本件の被害と発生原因\n'
    + incidents.map(item => `${item.attackerAction}\n${item.impact}\n${item.prosecutionKnowledge}\n${item.causalRefutation}\n${item.verdictBasis}`).join('\n\n')
    + '\n\n取得した資料を対応付けた結果、検察側が被告人によるものとした被害操作は、別の攻撃主体が用意した入力や処理を起点として発生したことが確認できました。被告人を当該攻撃の実行者とする検察側の説明は、この発生経路と矛盾します。この点が、被告人に対する無罪判決の根拠となります。';
  return paragraphs.join('\n\n') + '\n\n'
    + '以上の経緯と、資料から確認できる範囲を区別する必要があります。検察側が主張する操作を被告人本人に結び付ける裏付けは不十分であり、記録上のアカウントや端末だけで人物を断定することはできません。この合理的な疑いが、被告人に対する無罪判決の根拠となります。';
}
