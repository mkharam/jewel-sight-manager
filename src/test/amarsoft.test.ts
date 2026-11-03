import { describe, it, expect } from "vitest";
import { formatLD, periodDays, daysToRange } from "@/lib/amarsoft";

describe("amarsoft helpers", () => {
  it("converts dirhams to LD with separators", () => {
    expect(formatLD(11300000)).toBe("11,300 د.ل");
  });
  it("week starts on Saturday (Tripoli)", () => {
    // Tue 2026-11-03 12:00 UTC → week starts Sat 2026-10-31
    expect(periodDays("week", new Date("2026-11-03T12:00:00Z")).from).toBe("2026-10-31");
  });
  it("uses Tripoli date near midnight", () => {
    // 23:30 UTC on Nov 3 is already Nov 4 in Tripoli
    expect(periodDays("today", new Date("2026-11-03T23:30:00Z")).from).toBe("2026-11-04");
  });
  it("range end is exclusive next day at Tripoli midnight", () => {
    expect(daysToRange("2026-11-01", "2026-11-03")).toEqual({
      start: "2026-11-01T00:00:00+02:00", end: "2026-11-04T00:00:00+02:00",
    });
  });
});
