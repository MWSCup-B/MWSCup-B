import { publicInvestigationQuestion } from './court-questions.js';
import { procedureMethods } from './investigation-procedures.js';
import { investigationProgress, workspaceMaterial, COMMAND_HELP } from './investigation-workspace.js';

const labels = { EMAIL: '保存メール', WEB_ACCESS_LOG: 'Webアクセスログ', AUTHENTICATION_LOG: '認証ログ',
  APPLICATION_LOG: 'アプリケーションログ', DATABASE_LOG: 'DB監査ログ', NETWORK_LOG: '通信ログ',
  DEVICE_INFORMATION: '端末計測', FILE_METADATA: 'ファイル検査', DOCUMENT: '保存文書・設定' };

const vocabulary = {
  EMAIL: 'Fromは差出人欄、Subjectは件名です。メール本文に表示される文字と、HTMLのhrefに指定されたリンク先は別々に確認します。保存メールは記録された文面を読む資料であり、受信者が実際に操作したことを示す記録ではありません。',
  WEB_ACCESS_LOG: 'Webへの要求とは、ブラウザなどがサーバーへページや処理を求める通信です。timestampは記録時刻、request_targetは要求先です。ログに存在する項目を確認し、時刻と対象で候補を探します。要求の記録だけで、画面での処理やDBでの実行まで成功したとは限りません。',
  DATABASE_LOG: 'DBはデータベースの略です。監査記録は、DBで扱われた処理を後から確認するための資料です。statement・sql・queryなどの欄には、記録対象のSQLが示されます。SQLのSELECT句は取得する列や式、FROM句は参照する表、WHERE句は行を選ぶ条件を指定します。引用符で囲まれた文字列と、その外側の条件式・演算子を分けて読みます。Webログに入力本文がなければ、その内容を推測で埋めてはいけません。',
  AUTHENTICATION_LOG: '認証とは、提示された情報を使ってアカウントの利用を認めるか確認する処理です。accountはアカウント、source_ipは接続元のIPアドレス、resultは結果を示す項目の例です。成功した認証と、その後に何をしたかは別々に確認します。アカウント名だけで実際の人物は確定しません。',
  APPLICATION_LOG: 'アプリケーションが扱った処理の記録です。記録の対象、識別子、実際に残された結果を確認します。保存を受け付けたこと、処理が完了したこと、別の端末で実行されたことを混同しないよう、別資料との対応を確かめます。',
  DEVICE_INFORMATION: '端末上の処理や状態を計測した資料です。ブラウザ計測では、どの閲覧対象の何を観測したかを確認します。プロセス計測では、動いているプログラムの識別子や、別のプロセスを起動した親子関係を読みます。資料にない計測値や実行結果は補いません。',
  FILE_METADATA: 'ファイルの状態を検査した資料です。ハッシュは内容から計算する検査値で、前後の値が異なることは内容の変化を示します。ただし、その違いだけで暗号化や攻撃の原因まで確定するわけではありません。対象ファイルと検査方法・結果を確認します。',
};

// Commands describe a read-only operation on an exported UTF-8 teaching file.
// They are never passed to a shell or used as a filesystem path.
export function materialMethods(item) {
  const log = item.type.endsWith('_LOG');
  return log ? [
    { methodId: 'head', label: 'head -n 20 -- material.txt', description: '先頭20行から記録項目と時刻の表記を確認する。' },
    { methodId: 'tail', label: 'tail -n 20 -- material.txt', description: '末尾20行を読み、先頭付近との違いを確認する。' },
    { methodId: 'numbered', label: 'nl -ba -d "" -- material.txt', description: '全行に行番号を付け、前後の記録を照合する。' },
    { methodId: 'full', label: 'cat -- material.txt', description: '全文を読み、対象の要求・相関ID・結果を他の資料と照合する。' },
  ] : [
    { methodId: 'head', label: item.type === 'EMAIL' ? 'メールのヘッダーと本文冒頭を読む' : '資料の冒頭20行から項目と取得範囲を確認する', description: '先頭の内容を確認する。' },
    { methodId: 'full', label: item.type === 'EMAIL' ? '保存メールの全文・HTMLソースを文字列として確認する' : '資料の全文を開き、時刻・識別子・処理内容を照合する', description: 'リンクや記載された命令を実行せず、原文を読む。' },
  ];
}

export function materialEntries(gameCase) {
  return gameCase.detective.evidence.filter(item => item.type !== 'TESTIMONY').map((item, index) => {
    const rule = gameCase.detective.evidenceDiscoveryRules.find(rule => rule.evidenceId === item.evidenceId);
    const target = gameCase.detective.investigationTargets.find(target => target.targetId === rule?.targetId);
    return { materialId: item.evidenceId, targetId: rule?.targetId,
      label: `${String(index + 1).padStart(2, '0')} ${labels[item.type] ?? '調査資料'} — ${target?.displayName ?? '資料保管先'}`,
      type: item.type, methods: materialMethods(item) };
  });
}

export function materialQuestion(gameCase, materialId, round) {
  if (round !== undefined) return gameCase.progression.courtIssues?.[round - 1]?.question;
  const targetId = gameCase.detective.evidenceDiscoveryRules.find(rule => rule.evidenceId === materialId)?.targetId;
  return gameCase.progression.courtIssues?.find(issue => issue.investigationTargetId === targetId)?.question;
}

export function materialWorkbench(session, gameCase) {
  return { schemaVersion: '1.0', workspaceVersion: '1.0', help: COMMAND_HELP,
    progress: investigationProgress(session, gameCase), savedObservations: session.savedObservations ?? [],
    materials: materialEntries(gameCase).map(material => {
    const question = materialQuestion(gameCase, material.materialId, session.currentRound);
    // A question may quote several documents. Do not expose their contents before discovery.
    const readable = session.collectedEvidenceIds.includes(material.materialId)
      && question?.supportingQuotes.every(quote => session.collectedEvidenceIds.includes(quote.evidenceId));
    const plan = gameCase.progression.materialInvestigations?.find(item => item.evidenceId === material.materialId);
    const index = session.materialProgress?.[material.materialId] ?? 0;
    const item = gameCase.detective.evidence.find(item => item.evidenceId === material.materialId);
    return { ...material, ...workspaceMaterial(session, item), ...(plan ? { methods: procedureMethods(plan, index)
      .map(({ methodId, label, description }) => ({ methodId, label, description })),
      step: { number: Math.min(index + 1, plan.steps.length), total: plan.steps.length,
        prompt: plan.steps[index]?.prompt ?? '調査が完了しました。資料の原文と他の記録を照合できます。' } } : {}),
      examined: session.discoveredEvidenceIds.includes(material.materialId),
      collected: session.collectedEvidenceIds.includes(material.materialId),
      result: session.materialResults?.[material.materialId] ?? null,
      ...(readable ? { question: publicInvestigationQuestion(question) } : {}) };
  }), result: session.lastMaterialResult ?? null };
}

export function materialOutput(content, methodId) {
  const lines = content.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (methodId === 'head') return lines.slice(0, 20).join('\n');
  if (methodId === 'tail') return lines.slice(-20).join('\n');
  if (methodId === 'numbered') return lines.map((line, index) => `${String(index + 1).padStart(6)}\t${line}`).join('\n');
  return content;
}

export function buildCaseStudy(runtime) {
  const gameCase = runtime.gameCase;
  return { schemaVersion: '1.0', title: gameCase.title,
    incident: runtime.publicGameCase.progression.outcomes.acquitted.publicExplanation,
    materials: materialEntries(gameCase).map(material => {
      const item = gameCase.detective.evidence.find(item => item.evidenceId === material.materialId);
      const plan = gameCase.progression.materialInvestigations?.find(item => item.evidenceId === material.materialId);
      return { label: material.label, content: item.publicContent, vocabulary: vocabulary[item.type] ?? '資料の記載内容と、検察側による解釈を分けて確認します。',
        procedures: plan ? plan.steps.map((step, index) => ({ label: `${index + 1}. ${step.prompt}`,
          description: `${procedureMethods(plan, index).find(method => method.index === step.correctOptionIndex).label}\n${step.explanation}` }))
          : material.methods.map(method => ({ label: method.label, description: method.description })) };
    }), issues: (gameCase.progression.courtIssues ?? []).filter(issue => issue.question)
      .map(issue => {
        const question = issue.question;
        const claim = runtime.publicGameCase.courtroom.testimonies.flatMap(item => item.statements)
          .find(item => item.statementId === question.statementId)?.spokenContent;
        return { prompt: question.prompt, claim, answer: question.choices[question.correctOptionIndex],
          explanation: question.explanation,
          references: question.supportingQuotes.map(quote => ({ ...quote,
            title: gameCase.detective.evidence.find(item => item.evidenceId === quote.evidenceId)?.title ?? '資料' })) };
      }) };
}
