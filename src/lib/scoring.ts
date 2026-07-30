import type { ScoreState } from "../types";

export interface PerformanceMetrics {
  precision: number;
  timing: number;
  noteAccuracy: number;
  attempted: number;
}

/**
 * Precision combines rhythmic quality and note accuracy. A perfectly timed
 * performance with wrong or missing notes cannot obtain a perfect score.
 */
export function calculatePerformanceMetrics(
  score: ScoreState,
): PerformanceMetrics {
  const attempted = score.correct + score.missed + score.wrong;
  if (attempted === 0) {
    return { precision: 100, timing: 100, noteAccuracy: 100, attempted: 0 };
  }

  const timing =
    score.correct === 0
      ? 0
      : Math.max(0, Math.min(1, score.timingSum / score.correct));
  const noteAccuracy = score.correct / attempted;

  return {
    precision: Math.round(timing * noteAccuracy * 100),
    timing: Math.round(timing * 100),
    noteAccuracy: Math.round(noteAccuracy * 100),
    attempted,
  };
}
