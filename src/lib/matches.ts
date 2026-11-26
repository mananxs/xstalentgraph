import type { MatchDto } from "./types";

/** Display order: scored candidates (best first), then those still being scored, then failed ones. */
export function sortMatches(matches: MatchDto[]): MatchDto[] {
  const group = (match: MatchDto): number => (match.status === "completed" ? 0 : match.status === "pending" ? 1 : 2);

  return [...matches].sort((a, b) => {
    const byGroup = group(a) - group(b);
    if (byGroup !== 0) return byGroup;

    const byScore = (b.score ?? -1) - (a.score ?? -1);
    if (byScore !== 0) return byScore;

    return a.candidate.login.localeCompare(b.candidate.login);
  });
}

/**
 * Rank of every scored candidate (1 = best). Calculated from ALL scored candidates,
 * so a rank does not change when the person filters or searches.
 */
export function buildRankMap(matches: MatchDto[]): Map<string, number> {
  const ranks = new Map<string, number>();
  let rank = 1;
  for (const match of sortMatches(matches)) {
    if (match.status === "completed") {
      ranks.set(match.matchId, rank);
      rank += 1;
    }
  }
  return ranks;
}

/**
 * The minimum-score filter only applies to scored candidates.
 * Unscored ones (still scoring, or failed) are shown only while the filter is at 0.
 */
export function passesScoreFilter(match: MatchDto, minScore: number): boolean {
  if (match.status === "completed") return (match.score ?? 0) >= minScore;
  return minScore === 0;
}

/** How many candidates the pipeline shows per job. */
export const TOP_N = 10;

/** The best `n` candidates in display order (scored ones first, then still scoring, then failed). */
export function topMatches(matches: MatchDto[], n: number = TOP_N): MatchDto[] {
  return sortMatches(matches).slice(0, n);
}
