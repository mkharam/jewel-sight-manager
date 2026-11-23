import { describe, it, expect } from "vitest";
import { buildBoard, summaryText } from "@/lib/evalBoard";
import type { EvalStaff, Evaluation } from "@/lib/evaluation";

const B1 = "b1";
const staff: EvalStaff[] = [
  { id: "m1", name: "عبدالله", role: "manager", branch_id: B1, branch_name: "01" },
  { id: "e1", name: "احمد", role: "employee", branch_id: B1, branch_name: "01" },
  { id: "e2", name: "مهيمن", role: "employee", branch_id: B1, branch_name: "01" },
  { id: "e3", name: "سالم", role: "employee", branch_id: B1, branch_name: "01" },
  { id: "x1", name: "بلا مشرف", role: "employee", branch_id: "b9", branch_name: "09" },
];
const crit = (v: number, n = 11) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`c${i}`, v]));
let seq = 0;
const ev = (period: string, kind: Evaluation["kind"], evaluator: string, subject: string, v: number | null, extra: Partial<Evaluation> = {}): Evaluation => ({
  id: `ev${seq++}`, month: `${period.slice(0, 7)}-01`, period, kind, evaluator_id: evaluator, subject_id: subject,
  scores: v == null ? {} : crit(v), overall: v, strengths: null, improvements: null, notes: null,
  source: "link", entered_by: null, created_at: "", updated_at: "", ...extra,
});

const evals: Evaluation[] = [
  // احمد: المشرف عطاه 3 يومين، وهو قيّم نفسه 5 في كل البنود → أحمر.
  ev("2026-11-01", "by_manager", "m1", "e1", 3), ev("2026-11-02", "by_manager", "m1", "e1", 3),
  ev("2026-11-01", "self", "e1", "e1", 5),
  // مهيمن: المشرف عطاه 4.5، وما قيّمش نفسه. ويوم غايب.
  ev("2026-11-01", "by_manager", "m1", "e2", 4.5),
  ev("2026-11-02", "by_manager", "m1", "e2", null, { absent: true, absence_reason: "مرض" }),
  // سالم: قيّم نفسه 5 كاملة بس، والمشرف ما قيّمهوش → برّا الترتيب.
  ev("2026-11-01", "self", "e3", "e3", 5),
  // المشرف: موظفينه قيّموه 4 و2، وهو قيّم نفسه 4.
  ev("2026-11-01", "of_manager", "e1", "m1", 4), ev("2026-11-01", "of_manager", "e2", "m1", 2),
  ev("2026-11-01", "self", "m1", "m1", 4),
];

describe("لوحة التقييم", () => {
  const b = buildBoard(staff, evals, "2026-11-01", "2026-11-03");
  const p = (id: string) => b.byId.get(id)!;

  it("الدرجة من تقييم الغير بس — التقييم الذاتي ما يدخلش", () => {
    expect(p("e1").final).toBe(3);
    expect(p("e1").self).toBe(5);
    expect(p("m1").final).toBe(3);
    // اللي قيّم نفسه 5 بس ما يتصدرش: برّا الترتيب.
    expect(p("e3").final).toBeNull();
    expect(b.rated.map((x) => x.id)).toEqual(["e2", "e1", "m1"]);
    expect(b.unrated.map((x) => x.id).sort()).toEqual(["e3", "x1"]);
  });

  it("الغياب ما ينقصش الدرجة ويتعدّ", () => {
    expect(p("e2").final).toBe(4.5);
    expect(p("e2").presentDays).toBe(1);
    expect(p("e2").absences.map((e) => e.absence_reason)).toEqual(["مرض"]);
  });

  it("علامة على اللي قيّم نفسه 5 في كل البنود", () => {
    expect(p("e1").selfAll5).toBe(true);
    expect(p("e1").flag?.level).toBe("red");
    expect(p("e3").flag?.level).toBe("amber");
    expect(p("e2").flag).toBeNull();
    expect(b.all5.map((x) => x.id)).toEqual(["e1", "e3"]);
  });

  it("يقول ليش واحد ما اتقيّمش", () => {
    expect(p("e3").whyNot).toContain("عبدالله ما قيّمهوش");
    expect(p("e3").whyNot).toContain("قيّم نفسه بس");
    expect(p("x1").whyNot).toBe("ما فيش مشرف في فرعه يقيّمه");
  });

  it("مين اتقيّم كل يوم", () => {
    expect(b.dayStats.map((d) => [d.day, d.done, d.absent, d.expected])).toEqual([
      ["2026-11-01", 2, 0, 3], ["2026-11-02", 2, 1, 3], ["2026-11-03", 0, 0, 3],
    ]);
    expect(p("m1").daysRated).toBe(2);
    // اليوم (3) لسه مفتوح — ما يتحسبش ناقص؛ بكرة يتحسب.
    expect(p("e1").missedDays).toBe(0);
    expect(buildBoard(staff, evals, "2026-11-01", "2026-11-04").byId.get("e1")!.missedDays).toBe(1);
    // شهر خلص: كل أيامه تتحسب.
    expect(buildBoard(staff, evals, "2026-11-01", "2026-12-05").byId.get("e1")!.missedDays).toBe(28);
  });

  it("نص الواتساب: الترتيب من الغير، واللي ما اتقيّموش", () => {
    const t = summaryText(b);
    expect(t).toContain("التقييم الذاتي ما يدخلش");
    expect(t).toContain("ما اتقيّموش لين توا: سالم، بلا مشرف");
    expect(t.indexOf("مهيمن")).toBeLessThan(t.indexOf("احمد"));
  });
});
