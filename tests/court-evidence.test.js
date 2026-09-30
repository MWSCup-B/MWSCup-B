import test from 'node:test';
import assert from 'node:assert/strict';
import { courtEvidenceLines, hasSufficientCourtEvidence, quoteLineRanges }
  from '../server/generation/court-evidence.js';

const source = { evidenceId: 'auth', publicContent: 'routine record\r\nrequest=a source=external\r\nsession=a accepted\r\nroutine end' };
const question = { supportingQuotes: [{ evidenceId: 'auth', quote: 'request=a source=external' },
  { evidenceId: 'auth', quote: 'session=a accepted' }] };
const game = { detective: { evidence: [source] }, progression: {
  courtIssues: [{ requiredEvidenceIds: ['auth'], question }], investigation: { requiredForCourtIds: ['auth'] } } };
const facts = (...lines) => lines.map(line => ({ line, text: source.publicContent.split(/\r?\n/)[line - 1] }));
const grade = savedFacts => hasSufficientCourtEvidence(game, { collectedEvidenceIds: ['auth'], savedFacts });

test('each necessary source quotation must be covered, not only a document or one matching fact', () => {
  assert.equal(grade({ auth: facts(1) }), false);
  assert.equal(grade({ auth: facts(2) }), false);
  assert.equal(grade({ auth: facts(3) }), false);
  assert.equal(grade({ auth: facts(3, 2) }), true);
  assert.equal(grade({ auth: facts(1, 2, 3, 4) }), true);
  assert.deepEqual(courtEvidenceLines(game, 1, 'auth'), [2, 3]);
});

test('missing excerpts fail closed and only explicit whole-document acquisition permits originals', () => {
  assert.equal(grade({}), false);
  assert.equal(grade({ auth: [] }), false);
  assert.equal(hasSufficientCourtEvidence(game, { collectedEvidenceIds: ['auth'], wholeDocumentEvidenceIds: ['auth'] }), true);
  assert.equal(hasSufficientCourtEvidence(game, { collectedEvidenceIds: ['auth'], wholeDocumentEvidenceIds: ['auth'],
    savedFacts: { auth: facts(1) } }), false);
  assert.equal(grade({ auth: [{ line: 1, text: facts(2)[0].text }, ...facts(3)] }), false);
  assert.equal(grade({ auth: [...facts(2, 3), { line: 500, text: 'forged' }] }), false);
});

test('a multiline quote requires one original contiguous occurrence, with CRLF source positions intact', () => {
  const content = 'a\r\nfirst\r\nsecond\r\nfirst\r\nomitted\r\nsecond';
  assert.deepEqual(quoteLineRanges(content, 'first\r\nsecond'), [[2, 3]]);
  const multiple = { detective: { evidence: [{ evidenceId: 'auth', publicContent: content }] }, progression: {
    courtIssues: [{ requiredEvidenceIds: ['auth'], question: { supportingQuotes: [{ evidenceId: 'auth', quote: 'first\r\nsecond' }] } }] } };
  const save = lines => ({ collectedEvidenceIds: ['auth'], savedFacts: { auth: lines.map(line => ({ line,
    text: content.split(/\r?\n/)[line - 1] })) } });
  assert.equal(hasSufficientCourtEvidence(multiple, save([4, 6])), false);
  assert.equal(hasSufficientCourtEvidence(multiple, save([2, 3])), true);
  assert.deepEqual(quoteLineRanges('first\nsecond\nfirst\nsecond', 'first\nsecond'), [[1, 2], [3, 4]]);
});

test('missing verified grounds and future-only grounds cannot make a saved excerpt sufficient', () => {
  const unsupported = structuredClone(game);
  unsupported.progression.courtIssues[0].question.supportingQuotes = [];
  unsupported.progression.courtIssues.push(structuredClone(game.progression.courtIssues[0]));
  assert.equal(hasSufficientCourtEvidence(unsupported, { collectedEvidenceIds: ['auth'], savedFacts: { auth: facts(2, 3) } }), false);
  assert.equal(hasSufficientCourtEvidence(unsupported, { collectedEvidenceIds: ['auth'], wholeDocumentEvidenceIds: ['auth'] }), false);
  unsupported.progression.courtIssues.reverse();
  assert.equal(hasSufficientCourtEvidence(unsupported, { currentRound: 2, collectedEvidenceIds: ['auth'], savedFacts: { auth: facts(2, 3) } }), true);
});
