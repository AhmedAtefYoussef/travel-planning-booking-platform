// "#PR" is the placeholder a branch writes in the PR column of its traceability-matrix row before the pull
// request exists (open-pr.mjs replaces it). It must never reach develop: check-traceability.mjs rejects it.

/** Matches the placeholder as a whole token: "#PR" but not "#PR1" or "#PRs". */
export const PR_PLACEHOLDER = /#PR\b/g;

/** Replaces every "#PR" placeholder in matrix rows by "#<number>". */
export function replacePrPlaceholder(markdown, number) {
  let replaced = 0;
  const text = markdown
    .split('\n')
    .map((line) => {
      if (!line.startsWith('|') || !PR_PLACEHOLDER.test(line)) return line;
      PR_PLACEHOLDER.lastIndex = 0;
      replaced++;
      return line.replace(PR_PLACEHOLDER, `#${number}`);
    })
    .join('\n');
  return { text, replaced };
}
