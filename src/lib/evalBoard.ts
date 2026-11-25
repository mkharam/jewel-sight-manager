// حسبة لوحة التقييم — بلا واجهة، عشان تنفهم وتتجرّب لوحدها.
// القاعدة: درجة كل واحد من تقييم «الغير» بس — المشرف لموظفينه (كل يوم)، والموظفين لمشرفهم
// (مرتين في الشهر)، والمدير العام لو رجع. تقييمه لنفسه ما يدخلش في الدرجة ولا الترتيب: يبان لوحده
// للمقارنة، وعليه علامة لو عطى نفسه 5 في كل البنود (حمرا لو اللي يقيّموه عطوه أقل بوضوح).
// والمشرف: التزامه بالتقييم اليومي لموظفينه (كم يوم قيّمهم كاملين وكم فوّت)، وعلامة 📱 لو تقييم
// موظفينه ليه اتبعت من نفس التليفون اللي يقيّم منه هو (ممكن هو اللي عبّاه ولا شافه).
import { weekKey, ALL_CRITERIA, addDaysYmd, grade, monthLabel, shiftMonth, ymd, type EvalStaff, type Evaluation } from "@/lib/evaluation";

export const avg = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => x != null).map(Number);
  return v.length ? v.reduce((a, c) => a + c, 0) / v.length : null;
};
export const f1 = (v: number | null | undefined) => (v == null ? "—" : Number(v).toFixed(1));
/** «+1.2» / «−0.5» / «0.0». */
export const signed1 = (v: number) => `${v >= 0.05 ? "+" : v <= -0.05 ? "−" : ""}${Math.abs(v).toFixed(1)}`;
/** اليوم (للتقييم اليومي) ولا أول النص/الشهر. */
export const per = (e: Evaluation) => e.period ?? e.month;
/** أسبوع تقييم الموظف لمشرفه (التقييمات القديمة كانت بالنص — تنحسب على أسبوعها). */
export const wk = (e: Evaluation) => weekKey(per(e));

/** قيّم نفسه 5 في كل البنود (3 بنود على الأقل). */
export const isAll5 = (e: Evaluation) => {
  const v = Object.values(e.scores ?? {}).map(Number);
  return v.length >= 3 && v.every((x) => x === 5);
};

/** اللي يقيّموه: «مشرفه» للموظف، «موظفينه» للمشرف. */
export const ratersWord = (s: { role: string }) => (s.role === "manager" ? "موظفينه" : "مشرفه");
const gaveWord = (s: { role: string }) => (s.role === "manager" ? "عطوه" : "عطاه");
const notYetWord = (s: { role: string }) => (s.role === "manager" ? "ما قيّموهش" : "ما قيّمهوش");

/** علامة: حمرا = قيّم نفسه 5 كاملة واللي يقيّموه عطوه أقل بوضوح (ولا 📱 تقييمات من تليفونه). */
export type Flag = { level: "red" | "amber"; short: string; text: string; icon?: string };

/** التزام المشرف بالتقييم اليومي — على الأيام اللي خلصت (اليوم لسه مفتوح). */
export type Duty = {
  level: "ok" | "amber" | "red";
  /** عدد موظفينه. */
  n: number;
  /** الأيام اللي خلصت من الشهر. */
  closed: number;
  /** أيام قيّم فيها كل موظفينه (ولا سجّلهم غايب). */
  full: number;
  /** أيام قيّم فيها بعضهم بس. */
  part: number;
  /** أيام ما قيّم فيها ولا واحد. */
  none: number;
  /** part + none. */
  skipped: number;
  /** اليوم (الشهر الحالي): كم واحد قيّم لين توا. */
  today: number | null;
  /** كل موظف: كم يوم (من اللي خلصو) قيّمه — الأقل أول. */
  perStaff: { id: string; name: string; days: number }[];
  short: string;
  text: string;
};
export type Half = { key: string; label: string; started: boolean };

export type Person = EvalStaff & {
  /** الدرجة — من تقييم الغير بس. null = ما اتقيّمش من غيره (ما يدخلش الترتيب). */
  final: number | null;
  /** متوسط تقييمه لنفسه في الشهر — للمقارنة بس. */
  self: number | null;
  gm: number | null;
  /** درجته في الشهر اللي فات (من الغير). */
  prev: number | null;
  /** كل التقييمات عليه في الشهر. */
  evals: Evaluation[];
  /** تقييمات الغير عليه بدرجات (بدون أيام الغياب). */
  others: Evaluation[];
  /** تقييماته لنفسه. */
  selfs: Evaluation[];
  /** للمشرف: تقييماته اليومية لموظفينه في الشهر. */
  given: Evaluation[];
  presentDays: number;
  absences: Evaluation[];
  /** أيام خلصت من الشهر ما فيهاش تقييم يومي عليه (ولا غياب) — اليوم ما يتحسبش لين يخلص. */
  missedDays: number;
  selfAll5: boolean;
  flag: Flag | null;
  /** ليش ما عندهش درجة (لو final فاضي). */
  whyNot: string | null;
  /** مشرف فرعه (للموظف). */
  manager: EvalStaff | null;
  /** موظفين فرعه (للمشرف). */
  team: EvalStaff[];
  /** للمشرف: كم يوم قيّم فيه ولو واحد من موظفينه. */
  daysRated: number;
  /** للمشرف: التزامه بالتقييم اليومي (null للموظف ولا مشرف بلا موظفين). */
  duty: Duty | null;
  /** للمشرف: تقييمات موظفينه ليه اللي اتبعتو من نفس التليفون اللي يقيّم منه هو. */
  samePhone: Evaluation[];
  phone: Flag | null;
  /** درجته لو شلنا تقييمات samePhone. */
  finalClean: number | null;
};

export type Branch = { name: string; people: Person[]; managers: Person[]; staff: Person[]; avg: number | null; rated: number };
export type DayStat = { day: string; expected: number; done: number; absent: number };

/** أيام الشهر: كم فات منها، ونصّيه. */
export function monthInfo(month: string, today: string) {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const isCur = today.slice(0, 7) === month.slice(0, 7);
  const elapsed = isCur ? Number(today.slice(8, 10)) : today > month ? dim : 0;
  const halves: Half[] = [
    { key: ymd(y, m, 1), label: "1–15", started: elapsed >= 1 },
    { key: ymd(y, m, 16), label: `16–${dim}`, started: elapsed >= 16 },
  ];
  const days = Array.from({ length: dim }, (_, i) => ymd(y, m, i + 1));
  // تقييم المشرف: كل خميس في الشهر (نفس weekKey).
  const weeks: Half[] = Array.from({ length: dim }, (_, i) => ymd(y, m, i + 1))
    .filter((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 4)
    .map((k) => ({ key: k, label: `الخميس ${Number(k.slice(8, 10))}`, started: elapsed >= Number(k.slice(8, 10)) }));
  return { dim, isCur, elapsed, halves, weeks, days };
}

/** الأحمر أول، بعدين الأصفر؛ وداخل كل وحدة الأكبر فرق بين تقييمه لنفسه وتقييم غيره. */
const flagOrder = (a: Person, b: Person) =>
  (a.flag?.level === "red" ? 0 : a.flag ? 1 : 2) - (b.flag?.level === "red" ? 0 : b.flag ? 1 : 2)
  || ((b.self ?? 0) - (b.final ?? 5)) - ((a.self ?? 0) - (a.final ?? 5));

export function buildBoard(staff: EvalStaff[], evals: Evaluation[], month: string, today: string) {
  const info = monthInfo(month, today);
  // «المدير العام» صف للتقييم بس (هو اللي يقيّم)، ما يدخلش في الترتيب.
  const active = staff.filter((s) => s.active !== false && s.role !== "gm");
  const byMonth = new Map<string, Evaluation[]>();
  for (const e of evals) byMonth.set(e.month, [...(byMonth.get(e.month) ?? []), e]);
  const inMonth = (m: string) => byMonth.get(m) ?? [];
  const monthEvals = inMonth(month);

  // الأيام اللي خلصت (اليوم لسه مفتوح — ما يتحسبش ناقص لين يخلص).
  const closed = info.isCur ? info.elapsed - 1 : info.elapsed;
  const closedDays = info.days.slice(0, Math.max(closed, 0));

  // تليفونات كل واحد: الأجهزة اللي بعت منها تقييماته هو من الرابط (على كل الشهور المحمّلة).
  const devicesOf = new Map<string, Set<string>>();
  for (const e of evals) {
    if (!e.device_id || e.source !== "link") continue;
    const set = devicesOf.get(e.evaluator_id) ?? new Set<string>();
    set.add(e.device_id);
    devicesOf.set(e.evaluator_id, set);
  }
  /** تقييم موظف لمشرفه اتبعت من نفس التليفون اللي يقيّم منه المشرف نفسه. */
  const fromSubjectPhone = (e: Evaluation) =>
    e.kind === "of_manager" && e.source === "link" && !!e.device_id && e.evaluator_id !== e.subject_id
    && !!devicesOf.get(e.subject_id)?.has(e.device_id);

  const dutyOf = (team: EvalStaff[], given: Evaluation[]): Duty | null => {
    const n = team.length;
    if (!n) return null;
    const ids = new Set(team.map((t) => t.id));
    const byDay = new Map<string, Set<string>>();
    for (const e of given) {
      if (!ids.has(e.subject_id)) continue;
      const set = byDay.get(per(e)) ?? new Set<string>();
      set.add(e.subject_id);
      byDay.set(per(e), set);
    }
    let full = 0, part = 0, none = 0;
    for (const d of closedDays) {
      const k = byDay.get(d)?.size ?? 0;
      if (k >= n) full++; else if (k > 0) part++; else none++;
    }
    const skipped = part + none;
    const days = closedDays.length;
    const level: Duty["level"] = skipped >= 3 && skipped / Math.max(days, 1) >= 0.25 ? "red" : skipped >= 3 ? "amber" : "ok";
    const perStaff = team.map((t) => ({ id: t.id, name: t.name, days: closedDays.filter((d) => byDay.get(d)?.has(t.id)).length }))
      .sort((a, b) => a.days - b.days);
    const worst = perStaff[0];
    const short = level === "ok" ? (days ? `قيّم موظفينه ${full}/${days} يوم` : "الشهر بدا اليوم") : `فوّت ${skipped} يوم في التقييم اليومي`;
    const text = !days ? "الشهر بدا اليوم — ما فيش أيام خلصت لين توا."
      : `قيّم كل موظفينه في ${full} يوم من ${days}${part ? `، وبعضهم بس في ${part}` : ""}${none ? `، وما قيّم ولا واحد في ${none}` : ""}.`
        + (worst && worst.days < days ? ` أكثر واحد يفوّته: ${worst.name} (قيّمه ${worst.days} يوم من ${days}).` : "");
    return { level, n, closed: days, full, part, none, skipped, today: info.isCur ? byDay.get(today)?.size ?? 0 : null, perStaff, short, text };
  };

  const managerOf = (s: EvalStaff) =>
    s.branch_id == null ? null : active.find((m) => m.role === "manager" && m.branch_id === s.branch_id && m.id !== s.id) ?? null;
  const teamOf = (s: EvalStaff) =>
    s.branch_id == null ? [] : active.filter((t) => t.role !== "manager" && t.branch_id === s.branch_id && t.id !== s.id);

  const scoreOf = (s: EvalStaff, m: string) => {
    const es = inMonth(m).filter((e) => e.subject_id === s.id);
    const others = es.filter((e) => e.kind !== "self" && !e.absent && e.overall != null);
    const selfs = es.filter((e) => e.kind === "self");
    return {
      es, others, selfs,
      final: avg(others.map((e) => e.overall)),
      self: avg(selfs.map((e) => e.overall)),
      gm: avg(es.filter((e) => e.kind === "by_gm").map((e) => e.overall)),
    };
  };

  const people: Person[] = active.map((s) => {
    const c = scoreOf(s, month);
    const daily = c.es.filter((e) => e.kind === "by_manager");
    const absences = daily.filter((e) => e.absent).sort((a, b) => per(a).localeCompare(per(b)));
    const presentDays = new Set(daily.filter((e) => !e.absent).map(per)).size;
    const manager = s.role === "manager" ? null : managerOf(s);
    const team = s.role === "manager" ? teamOf(s) : [];
    const given = monthEvals.filter((e) => e.evaluator_id === s.id && e.kind === "by_manager");
    const lastClosed = info.isCur ? addDaysYmd(today, -1) : info.days[info.elapsed - 1];
    const missedDays = s.role !== "manager" && manager && closed > 0
      ? Math.max(0, closed - new Set(daily.filter((e) => per(e) <= lastClosed).map(per)).size)
      : 0;
    const selfAll5 = c.selfs.some(isAll5);

    const who = ratersWord(s), gave = gaveWord(s);
    let flag: Flag | null = null;
    if (selfAll5 && c.final != null && 5 - c.final >= 0.5) {
      flag = { level: "red", short: `قيّم نفسه 5 · ${who} ${gave} ${f1(c.final)}`,
        text: `قيّم نفسه 5 في كل البنود، لكن ${who} ${gave} ${f1(c.final)} — الفرق ${f1(5 - c.final)}. يستاهل جلسة كلام معاه.` };
    } else if (selfAll5) {
      flag = { level: "amber", short: "قيّم نفسه 5 كاملة",
        text: c.final == null
          ? `قيّم نفسه 5 في كل البنود، و${who} ${notYetWord(s)} لين توا — ما يدخلش الترتيب لين يقيّموه.`
          : `قيّم نفسه 5 في كل البنود، و${who} ${gave} ${f1(c.final)} — قريب من تقييمه لنفسه.` };
    } else if (c.self != null && c.final != null && c.self - c.final >= 1) {
      flag = { level: "amber", short: `قيّم نفسه ${f1(c.self)} · ${who} ${gave} ${f1(c.final)}`,
        text: `قيّم نفسه ${f1(c.self)}، و${who} ${gave} ${f1(c.final)} — أعلى بـ ${f1(c.self - c.final)}.` };
    }

    let whyNot: string | null = null;
    if (c.final == null) {
      if (s.role === "manager") whyNot = team.length ? "موظفينه ما قيّموهش لين توا" : "ما عندهش موظفين في فرعه يقيّموه";
      else if (!manager) whyNot = "ما فيش مشرف في فرعه يقيّمه";
      else if (absences.length) whyNot = `${manager.name} سجّله غايب ${absences.length} يوم، وما قيّمهوش ولا يوم`;
      else whyNot = `${manager.name} ما قيّمهوش لين توا`;
      if (c.selfs.length) whyNot += " — قيّم نفسه بس، وهذا ما يحسبش";
    }

    // 📱 تقييمات موظفينه ليه من نفس تليفونه.
    const samePhone = s.role === "manager" ? c.others.filter(fromSubjectPhone) : [];
    const finalClean = samePhone.length ? avg(c.others.filter((e) => !samePhone.includes(e)).map((e) => e.overall)) : c.final;
    const phone: Flag | null = samePhone.length ? {
      level: "red", icon: "📱",
      short: `${samePhone.length} من تقييمات موظفينه من تليفونه`,
      text: `${samePhone.length} من تقييمات موظفينه ليه اتبعتو من نفس التليفون اللي يقيّم منه هو — يعني ممكن هو اللي عبّاهم ولا شاف كم عطوه. درجته بدونهم: ${f1(finalClean)}.`,
    } : null;

    return {
      ...s, final: c.final, self: c.self, gm: c.gm, prev: scoreOf(s, shiftMonth(month, -1)).final,
      evals: c.es, others: c.others, selfs: c.selfs, given, presentDays, absences, missedDays,
      selfAll5, flag, whyNot, manager, team, daysRated: new Set(given.map(per)).size,
      duty: s.role === "manager" ? dutyOf(team, given) : null, samePhone, phone, finalClean,
    };
  });

  const rated = people.filter((p) => p.final != null)
    .sort((a, b) => (b.final! - a.final!) || (b.others.length - a.others.length) || a.name.localeCompare(b.name, "ar"));
  const unrated = people.filter((p) => p.final == null);
  const low = rated.filter((p) => p.final! < 3);
  const all5 = people.filter((p) => p.selfAll5).sort(flagOrder);
  const flagged = people.filter((p) => p.flag).sort(flagOrder);

  const bmap = new Map<string, Person[]>();
  for (const p of people) { const k = p.branch_name ?? "بدون فرع"; bmap.set(k, [...(bmap.get(k) ?? []), p]); }
  const branches: Branch[] = [...bmap.entries()].map(([name, ps]) => {
    const r = ps.filter((p) => p.final != null);
    return { name, people: ps, managers: ps.filter((p) => p.role === "manager"), staff: ps.filter((p) => p.role !== "manager"), avg: avg(r.map((p) => p.final)), rated: r.length };
  }).sort((a, b) => ((b.avg ?? -1) - (a.avg ?? -1)) || a.name.localeCompare(b.name, "ar"));

  // متوسط كل بند — من تقييم الغير بس. الأضعف أول.
  const crit: Record<string, number[]> = {};
  for (const p of people) for (const e of p.others) for (const [k, val] of Object.entries(e.scores ?? {})) (crit[k] ??= []).push(Number(val));
  const criteria = Object.entries(crit).map(([key, xs]) => ({ key, label: ALL_CRITERIA[key] ?? key, avg: avg(xs)!, n: xs.length }))
    .sort((a, b) => a.avg - b.avg);

  // المتوسط شهر بشهر (آخر 6 أشهر): تقييم الغير، وتقييمهم لنفسهم للمقارنة.
  const trend = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5)).map((m) => {
    const sc = active.map((s) => scoreOf(s, m));
    return { month: monthLabel(m).split(" ")[0], avg: avg(sc.map((x) => x.final)), self: avg(sc.map((x) => x.self)) };
  });

  // كل يوم فات: كم موظف (عنده مشرف) اتقيّم ولا اتسجّل غايب.
  const expected = new Set(people.filter((p) => p.role !== "manager" && p.manager).map((p) => p.id));
  const daily = monthEvals.filter((e) => e.kind === "by_manager" && expected.has(e.subject_id));
  const days: DayStat[] = info.days.slice(0, info.elapsed).map((day) => {
    const es = daily.filter((e) => per(e) === day);
    const done = new Set(es.map((e) => e.subject_id));
    const present = new Set(es.filter((e) => !e.absent).map((e) => e.subject_id));
    return { day, expected: expected.size, done: done.size, absent: [...done].filter((id) => !present.has(id)).length };
  });

  return {
    month, today, dim: info.dim, isCur: info.isCur, elapsed: info.elapsed, halves: info.halves, weeks: info.weeks,
    /** كل أيام الشهر (YYYY-MM-DD). */
    allDays: info.days,
    /** الأيام اللي فاتت: كم موظف اتقيّم في كل يوم. */
    dayStats: days,
    people, rated, unrated, low, all5, flagged, branches, criteria, trend, monthEvals,
    overall: avg(rated.map((p) => p.final)),
    /** تقييمات الموظفين لمشرفهم اللي اتبعتو من تليفون المشرف (📱). */
    samePhoneIds: new Set(people.flatMap((p) => p.samePhone.map((e) => e.id))),
    byId: new Map(people.map((p) => [p.id, p])),
    scoreOf: (s: EvalStaff, m: string) => { const x = scoreOf(s, m); return { final: x.final, self: x.self }; },
  };
}
export type Board = ReturnType<typeof buildBoard>;

/** نتيجة الشهر كنص (واتساب/نسخ): كل فرع، كل واحد بدرجته (من الغير) وغيابه، ومين ما اتقيّمش. */
export function summaryText(b: Board) {
  const lines = [`نتيجة تقييم ${monthLabel(b.month)}`, "(من تقييم المشرف والموظفين لبعض — التقييم الذاتي ما يدخلش)"];
  for (const br of b.branches) {
    const r = br.people.filter((p) => p.final != null).sort((x, y) => y.final! - x.final!);
    if (!r.length) continue;
    lines.push("", `${br.name}:`);
    r.forEach((p, i) => lines.push(`${i + 1}. ${p.name}${p.role === "manager" ? " (مشرف)" : ""} — ${f1(p.final)} ${grade(p.final).label}`
      + `${p.absences.length ? ` · غاب ${p.absences.length} يوم` : ""}${p.duty?.closed ? ` · قيّم موظفينه ${p.duty.full} من ${p.duty.closed} يوم` : ""}`));
  }
  const lax = b.people.filter((p) => p.duty && p.duty.level !== "ok");
  if (lax.length) lines.push("", `مشرفين فوّتوا التقييم اليومي: ${lax.map((p) => `${p.name} (${p.duty!.skipped} يوم)`).join("، ")}`);
  if (b.unrated.length) lines.push("", `ما اتقيّموش لين توا: ${b.unrated.map((p) => p.name).join("، ")}`);
  if (b.low.length) lines.push("", `يحتاج متابعة: ${b.low.map((p) => p.name).join("، ")}`);
  return lines.join("\n");
}
