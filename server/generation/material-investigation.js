import { publicCourtQuestion } from './court-questions.js';
import { procedureMethods } from './investigation-procedures.js';

const labels = { EMAIL: '保存メール', WEB_ACCESS_LOG: 'Webアクセスログ', AUTHENTICATION_LOG: '認証ログ',
  APPLICATION_LOG: 'アプリケーションログ', DATABASE_LOG: 'DB監査ログ', NETWORK_LOG: '通信ログ',
  DEVICE_INFORMATION: '端末計測', FILE_METADATA: 'ファイル検査', DOCUMENT: '保存文書・設定' };

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

export function materialQuestion(gameCase, materialId) {
  const targetId = gameCase.detective.evidenceDiscoveryRules.find(rule => rule.evidenceId === materialId)?.targetId;
  return gameCase.progression.courtIssues?.find(issue => issue.investigationTargetId === targetId)?.question;
}

export function materialWorkbench(session, gameCase) {
  return { schemaVersion: '1.0', materials: materialEntries(gameCase).map(material => {
    const question = materialQuestion(gameCase, material.materialId);
    // A question may quote several documents. Do not expose their contents before discovery.
    const readable = session.collectedEvidenceIds.includes(material.materialId)
      && question?.supportingQuotes.every(quote => session.collectedEvidenceIds.includes(quote.evidenceId));
    const plan = gameCase.progression.materialInvestigations?.find(item => item.evidenceId === material.materialId);
    const index = session.materialProgress?.[material.materialId] ?? 0;
    return { ...material, ...(plan ? { methods: procedureMethods(plan, index)
      .map(({ methodId, label, description }) => ({ methodId, label, description })),
      step: { number: Math.min(index + 1, plan.steps.length), total: plan.steps.length,
        prompt: plan.steps[index]?.prompt ?? '調査が完了しました。資料の原文と他の記録を照合できます。' } } : {}),
      examined: session.discoveredEvidenceIds.includes(material.materialId),
      collected: session.collectedEvidenceIds.includes(material.materialId),
      result: session.materialResults?.[material.materialId] ?? null,
      ...(readable ? { question: publicCourtQuestion(question) } : {}) };
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
      return { label: material.label, content: item.publicContent,
        procedures: plan ? plan.steps.map((step, index) => ({ label: `${index + 1}. ${step.prompt}`,
          description: `${procedureMethods(plan, index).find(method => method.index === step.correctOptionIndex).label}\n${step.explanation}` }))
          : material.methods.map(method => ({ label: method.label, description: method.description })) };
    }), issues: (gameCase.progression.courtIssues ?? []).filter(issue => issue.question)
      .map(issue => ({ prompt: issue.question.prompt, explanation: issue.question.explanation })) };
}
