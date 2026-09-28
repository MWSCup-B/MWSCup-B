import { createHash } from 'node:crypto';
import { fail } from './schema.js';
import { LOG_TYPES, MIN_LOG_RECORDS, validateGeneratedLogFormats } from './evidence-log-format.js';

export const LOG_BACKGROUNDS_SCHEMA = {
  type: 'array', minItems: 0, maxItems: 64, items: {
    type: 'object', additionalProperties: false, required: ['evidenceId', 'samples'],
    properties: { evidenceId: { type: 'string', minLength: 1, maxLength: 160 },
      samples: { type: 'array', minItems: 3, maxItems: 8,
        items: { type: 'string', minLength: 2, maxLength: 2000 } } },
  },
};
const identifierField = /^(?:request|query|execution|attempt|event|correlation|process|session|post|storage|content)_(?:id|ref)$/;
const timeField = /^(?:timestamp|time|stored_at)$/;
const reject = message => fail('EVIDENCE_LOG_BACKGROUND_INVALID', 'logBackgrounds', message);

function formatTimeLike(value, millis) {
  const match = value.match(/(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) return new Date(millis).toISOString();
  const zone = match[2], offset = zone === 'Z' ? 0
    : (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4))) * (zone[0] === '+' ? 1 : -1);
  const local = new Date(millis + offset * 60000).toISOString();
  return local.slice(0, 19) + (match[1] ? local.slice(19, 19 + match[1].length) : '') + zone;
}

// Internal authoring only: expand explicit ordinary-event samples BEFORE sealing.
// Incident bytes and quotes stay intact. Never apply this to an imported package.
export function prepareLogBackgrounds(input) {
  if (!input?.logBackgrounds) return input;
  const draft = structuredClone(input), plans = draft.logBackgrounds;
  delete draft.logBackgrounds;
  if (!Array.isArray(plans) || plans.length > 64) reject('通常記録の生成例は64資料以内の配列で指定してください。');
  const seen = new Set(), artifacts = draft.evidenceArtifacts ?? [];
  const occupied = new Set(artifacts.flatMap(item => {
    if (typeof item.publicContent !== 'string') return [];
    return item.publicContent.split(/\r?\n/).flatMap(line => {
      try { return Object.entries(JSON.parse(line)).filter(([key]) => identifierField.test(key)).map(([, value]) => value); }
      catch { return []; }
    });
  }));
  for (const plan of plans) {
    const item = artifacts.find(item => item.evidenceId === plan?.evidenceId);
    if (!item || !LOG_TYPES.includes(item.type) || seen.has(item.evidenceId)
      || Object.keys(plan).some(key => !['evidenceId', 'samples'].includes(key))
      || !Array.isArray(plan.samples) || plan.samples.length < 3 || plan.samples.length > 8
      || plan.samples.some(sample => typeof sample !== 'string' || sample.length > 2000 || /[\r\n]/.test(sample))) {
      reject('各ログ資料に一つだけ、同じ取得条件の通常記録を3～8例、各1行のJSONで指定してください。');
    }
    seen.add(item.evidenceId);
    validateGeneratedLogFormats([item, ...plan.samples.map(publicContent => ({ type: item.type, publicContent }))]);
    const original = item.publicContent, lines = original.trimEnd().split(/\r?\n/);
    const count = Math.max(0, MIN_LOG_RECORDS - new Set(lines).size);
    if (!count) continue;
    for (const quote of draft.courtQuestions?.flatMap(question => question.supportingQuotes) ?? []) {
      if (quote.evidenceId === item.evidenceId && !original.includes(quote.quote))
        reject('設問の根拠は事件の原文から引用してください。通常記録の展開で正解の根拠を補完しません。');
    }
    const samples = plan.samples.map(JSON.parse);
    if (samples.some(sample => !Object.keys(sample).some(key => identifierField.test(key) || timeField.test(key))))
      reject('通常記録には、取得定義にある時刻または処理識別子を含めてください。');
    const times = lines.map(JSON.parse).flatMap(row => Object.entries(row)
      .filter(([key, value]) => timeField.test(key) && Number.isFinite(Date.parse(value))).map(([, value]) => Date.parse(value)));
    // Keep the original block intact, without placing every incident on line 51.
    const position = createHash('sha256').update(`${item.evidenceId}:${original}`).digest()[0];
    const before = Math.max(1, Math.min(count, Math.round(count * (0.2 + position / 255 * 0.6))));
    const expanded = Array.from({ length: count }, (_, index) => {
      const row = structuredClone(samples[index % samples.length]);
      for (const [key, value] of Object.entries(row)) {
        if (identifierField.test(key) && typeof value === 'string') {
          let serial = index + 1, candidate;
          do {
            candidate = /\d+$/.test(value) ? value.replace(/\d+$/, match => String(serial).padStart(match.length, '0'))
              : createHash('sha256').update(`${value}:${serial}`).digest('hex').slice(0, 16);
            serial += MIN_LOG_RECORDS;
          } while (occupied.has(candidate));
          row[key] = candidate;
        } else if (timeField.test(key) && typeof value === 'string' && Number.isFinite(Date.parse(value))) {
          const base = times.length ? (index < before ? Math.min(...times) : Math.max(...times)) : Date.parse(value);
          row[key] = formatTimeLike(value, base + (index < before ? index - before : index - before + 1) * 1000);
        }
      }
      return JSON.stringify(row);
    });
    item.publicContent = expanded.slice(0, before).join('\n') + '\n' + original
      + (original.endsWith('\n') ? '' : '\n') + expanded.slice(before).join('\n');
    for (const step of draft.materialInvestigations?.find(plan => plan.evidenceId === item.evidenceId)?.steps ?? []) {
      for (const choice of step.choices) {
        const op = choice.operation;
        if (op.kind !== 'LINES') continue;
        if (op.firstLine === 1 && op.lastLine === lines.length) op.lastLine += count;
        else { op.firstLine += before; op.lastLine += before; }
      }
    }
  }
  return draft;
}
