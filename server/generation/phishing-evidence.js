import { fail } from './schema.js';

const decode = value => value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi, entity => {
  const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
  if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
  const hex = /^&#x/i.test(entity);
  const code = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
});
function url(value) {
  try { const result = new URL(value); return /^https?:$/.test(result.protocol) ? result : null; }
  catch { return null; }
}

// Inspect inert saved source only. No HTML rendering, navigation, or network access.
export function phishingMailLinks(content) {
  return [...content.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)].flatMap(([, attributes, body]) => {
    const href = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attributes);
    const target = href && decode(href[1] ?? href[2]).trim();
    const display = decode(body.replace(/<[^>]*>/g, '')).trim();
    return target && url(target) ? [{ href: target, display }] : [];
  });
}

export function validatePhishingObservations(artifacts, attackGraph) {
  for (const node of attackGraph.nodes.filter(item => ['phishing', 'credential_phishing'].includes(item.attackDefinitionId))) {
    const source = sourceId => artifacts.filter(item => item.type !== 'TESTIMONY' && item.sourceRefs.some(ref =>
      ref.sourceType === 'ATTACK_GRAPH_ARTIFACT' && ref.attackNodeId === node.nodeId && ref.sourceId === sourceId));
    // The catalog promises a saved invitation link, not a disguised URL or a
    // proven click-to-request correlation. Homework examples cannot add either.
    const hasLink = source('email_record').some(item => phishingMailLinks(item.publicContent).length
      || (item.publicContent.match(/https?:\/\/[^\s<>"']+/g) ?? []).some(value => url(value)));
    if (!hasLink) fail('EVIDENCE_PHISHING_LINK_MISSING', 'evidenceArtifacts.publicContent',
      '保存メールの取得定義にある誘導リンクを公開本文で確認できません。', {
        correctionHint: '同じattackNodeIdの保存メールに、既存の取得定義の範囲で誘導内容とリンクを非実行の文字列で示してください。HTML形式やURL不一致は必須ではありません。引用・調査手順も本文に合わせてください。',
      });
  }
}
