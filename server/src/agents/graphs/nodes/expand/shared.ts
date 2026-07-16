export interface CheckOutcome {
  approved: boolean;
  contradictions: Array<{ excerpt: string; issue: string; correction: string }>;
}

export function buildCorrectionNote(contradictions: CheckOutcome['contradictions']): string {
  return contradictions
    .map((c) => `- Excerpt: "${c.excerpt}"\n  Issue: ${c.issue}\n  Fix: ${c.correction}`)
    .join('\n');
}

/**
 * Shared N-cycle check→revise loop for Continuity Editor+Scribe — checks and
 * revises a single draft string, outputting {approved, contradictions}.
 *
 * `level` (coherenceCheckLevel) <= 0 skips checking entirely. Otherwise runs
 * up to `level` check→revise cycles, stopping early the moment a check
 * approves; the last revision is never re-checked unless `safetyNet` adds one
 * more check-only pass at the end. A safety-net failure is flagged via
 * `onFlagged` but never blocks — the draft is returned as-is either way.
 * Deeper verification, if anything is still wrong, happens in Consolidate
 * (Linter, Warden), not here.
 */
export async function runCheckReviseLoop(params: {
  level: number;
  safetyNet: boolean;
  initialDraft: string;
  check: (draft: string) => Promise<{ output: CheckOutcome; tokensIn: number; tokensOut: number }>;
  revise: (draft: string, correctionNote: string) => Promise<{ draft: string; tokensIn: number; tokensOut: number }>;
  onFlagged: (check: CheckOutcome) => Promise<void>;
}): Promise<{ draft: string; lastCheck?: CheckOutcome; tokensIn: number; tokensOut: number }> {
  let draft = params.initialDraft;
  let lastCheck: CheckOutcome | undefined;
  let tokensIn = 0;
  let tokensOut = 0;

  for (let cycle = 0; cycle < params.level; cycle++) {
    const checkResult = await params.check(draft);
    tokensIn += checkResult.tokensIn;
    tokensOut += checkResult.tokensOut;
    lastCheck = checkResult.output;

    if (lastCheck.approved || lastCheck.contradictions.length === 0) break;

    const revisionResult = await params.revise(draft, buildCorrectionNote(lastCheck.contradictions));
    tokensIn += revisionResult.tokensIn;
    tokensOut += revisionResult.tokensOut;
    draft = revisionResult.draft;
  }

  if (params.safetyNet && params.level > 0) {
    const finalCheck = await params.check(draft);
    tokensIn += finalCheck.tokensIn;
    tokensOut += finalCheck.tokensOut;
    lastCheck = finalCheck.output;
    if (!lastCheck.approved && lastCheck.contradictions.length > 0) {
      await params.onFlagged(lastCheck);
    }
  }

  return { draft, lastCheck, tokensIn, tokensOut };
}
