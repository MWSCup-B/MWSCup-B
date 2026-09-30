// Private, deterministic evidence coverage. The grading basis is the existing
// verified source quotations, never attack-specific keywords or player text.
export function requiredCourtEvidence(gameCase, round) {
  const issue = gameCase.progression.courtIssues?.[round - 1];
  return [...new Set([...(issue?.requiredEvidenceIds ?? gameCase.progression.investigation.requiredForCourtIds),
    ...(issue?.question?.supportingQuotes.map(quote => quote.evidenceId) ?? [])])];
}

function supportingQuotes(gameCase, round, evidenceId) {
  const issues = gameCase.progression.courtIssues ?? [];
  const current = issues[round - 1]?.question?.supportingQuotes
    .filter(quote => quote.evidenceId === evidenceId) ?? [];
  // The final issue can require previously established exoneration support.
  // Only already-heard issues may supply that support, never future answers.
  return current.length ? current : issues.slice(0, round - 1).flatMap(issue =>
    issue.question?.supportingQuotes.filter(quote => quote.evidenceId === evidenceId) ?? []);
}

export function quoteLineRanges(content, quote) {
  if (typeof quote !== 'string' || !quote.trim() || !content.includes(quote)) return [];
  const ranges = [];
  for (let start = content.indexOf(quote); start !== -1; start = content.indexOf(quote, start + 1)) {
    const first = content.slice(0, start).split('\n').length;
    const last = content.slice(0, start + quote.length - 1).split('\n').length;
    ranges.push(Array.from({ length: last - first + 1 }, (_, index) => first + index));
  }
  return ranges;
}

// Evaluation/test callers can follow the same public save-line operations as a
// player. This private plan must never enter a player response or hint.
export function courtEvidenceLines(gameCase, round, evidenceId) {
  const source = gameCase.detective.evidence.find(item => item.evidenceId === evidenceId);
  const quotes = supportingQuotes(gameCase, round, evidenceId);
  if (!source || !quotes.length) return [];
  const ranges = quotes.map(({ quote }) => quoteLineRanges(source.publicContent, quote)[0]);
  if (ranges.some(range => !range)) return [];
  return [...new Set(ranges.flat())].sort((a, b) => a - b);
}

export function hasSufficientCourtEvidence(gameCase, { currentRound = 1, collectedEvidenceIds = [],
  savedFacts = {}, wholeDocumentEvidenceIds = [] }) {
  const issue = gameCase.progression.courtIssues?.[currentRound - 1];
  if (!issue) return true; // Original whole-document games have no question contract.
  const required = requiredCourtEvidence(gameCase, currentRound);
  if (!required.every(id => collectedEvidenceIds.includes(id))) return false;
  if (!issue.question) return true;
  return required.every(evidenceId => {
    const source = gameCase.detective.evidence.find(item => item.evidenceId === evidenceId);
    const quotes = supportingQuotes(gameCase, currentRound, evidenceId);
    if (!source || !quotes.length) return false;
    const ranges = quotes.map(({ quote }) => quoteLineRanges(source.publicContent, quote));
    if (ranges.some(occurrences => !occurrences.length)) return false;
    // Only an actual legacy whole-document acquisition can submit the original.
    // A missing/empty Workspace excerpt is not permission to fill it back in.
    if (!Object.hasOwn(savedFacts ?? {}, evidenceId)) return wholeDocumentEvidenceIds.includes(evidenceId);
    const facts = savedFacts[evidenceId];
    const lines = source.publicContent.split(/\r?\n/);
    if (lines.at(-1) === '') lines.pop();
    if (!Array.isArray(facts) || !facts.length || facts.some(fact => !Number.isInteger(fact?.line)
      || fact.line < 1 || fact.line > lines.length || fact.text !== lines[fact.line - 1])) return false;
    const saved = new Set(facts.map(fact => fact.line));
    // Each quotation needs one complete occurrence in its original location.
    // Joining disjoint saved lines cannot manufacture a contiguous quotation.
    return ranges.every(occurrences => occurrences.some(range => range.every(line => saved.has(line))));
  });
}
