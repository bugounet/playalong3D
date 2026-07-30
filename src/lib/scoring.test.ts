import { describe, expect, it } from "vitest";
import { calculatePerformanceMetrics } from "./scoring";

describe("performance scoring", () => {
  it("combines timing and wrong notes", () => {
    const metrics = calculatePerformanceMetrics({
      correct: 8,
      missed: 1,
      wrong: 1,
      timingSum: 7.2,
      streak: 0,
      bestStreak: 0,
    });
    expect(metrics.timing).toBe(90);
    expect(metrics.noteAccuracy).toBe(80);
    expect(metrics.precision).toBe(72);
  });

  it("gives 100 only to a complete perfectly timed performance", () => {
    const metrics = calculatePerformanceMetrics({
      correct: 10,
      missed: 0,
      wrong: 0,
      timingSum: 10,
      streak: 10,
      bestStreak: 10,
    });
    expect(metrics.precision).toBe(100);
  });
});
