// بيانات «الموظفين ← المقارنة» وصفحة الفرع: كل فرع وموظفينه — المبيعات من أمارسوفت، الربح فوق الذهب، تسجيل
// اسم ورقم الزبون، وتقييم الشهر (من تقييمهم لبعض). موظف التقييم يتربط ببائع أمارسوفت بحسابه في التطبيق ولا
// باسمه في نفس الفرع (راجع lib/teamMatch).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { sb, daysToRange } from "@/lib/amarsoft";
import { businessToday } from "@/lib/dates";
import { db, monthStart, type EvalStaff, type Evaluation } from "@/lib/evaluation";
import { buildBoard, type Duty, type Person } from "@/lib/evalBoard";
import { matchPeople } from "@/lib/teamMatch";

type EvalRow = { branch_code: string; branch_name: string; sman: string; salesman_name: string; invoices: number; grams: number; amount: number };
type GoldRow = { branch_code: string; sman: string; valued_grams: number; amount_lyd: number; gold_lyd: number };
type CapRow = { branch_code: string; sman: string; invoices: number; with_both: number };
type Seller = { branch_code: string; sman: string; name: string; profile_id: string | null };

export type Sales = { grams: number; invoices: number; lyd: number; goldLyd: number; valuedLyd: number; capInv: number; capBoth: number };
const noSales = (): Sales => ({ grams: 0, invoices: 0, lyd: 0, goldLyd: 0, valuedLyd: 0, capInv: 0, capBoth: 0 });
const plus = (a: Sales, b: Sales): Sales => ({
  grams: a.grams + b.grams, invoices: a.invoices + b.invoices, lyd: a.lyd + b.lyd, goldLyd: a.goldLyd + b.goldLyd,
  valuedLyd: a.valuedLyd + b.valuedLyd, capInv: a.capInv + b.capInv, capBoth: a.capBoth + b.capBoth,
});
export const abovePct = (s: Sales | null) => (s && s.goldLyd > 0 ? (s.valuedLyd / s.goldLyd - 1) * 100 : null);
export const custPct = (s: Sales | null) => (s && s.capInv > 0 ? (s.capBoth / s.capInv) * 100 : null);
export const avgInv = (s: Sales | null) => (s && s.invoices > 0 ? s.grams / s.invoices : null);
const num = (v: unknown) => Number(v ?? 0);
export const int = (v: number | null) => (v == null ? "—" : Math.round(v).toLocaleString("en-US"));

export type Line = { key: string; name: string; role: "manager" | "employee" | "seller"; sales: Sales | null; person: Person | null };
export type Block = { code: string; name: string; short: string; lines: Line[]; sales: Sales; evalAvg: number | null; duty: Duty | null; people: number };

/** «01 - حي الأندلس» ← «الأندلس». */
export const shortName = (name: string) => (name.split(" - ")[1] ?? name).replace(/^حي\s+/, "");

/**
 * كل فرع وموظفينه في فترة (من/إلى بأيام طرابلس): المبيعات من أمارسوفت، الربح فوق الذهب، تسجيل الزبون،
 * وتقييم الشهر الحالي. تستعمله «المقارنة» (كل الفروع) وصفحة الفرع (/branches/:code).
 */
export function useTeamBlocks(from: string, to: string) {
  const today = businessToday();
  const month = monthStart(today);

  const q = useQuery({
    queryKey: ["team-compare", from, to, month],
    queryFn: async () => {
      const r = daysToRange(from, to);
      const [ev, gold, cap, smen, br, staff, evals] = await Promise.all([
        sb.rpc("amarsoft_staff_eval", { p_start: r.start, p_end: r.end, p_branch: null }),
        sb.rpc("amarsoft_staff_eval_gold", { p_start: r.start, p_end: r.end, p_branch: null }),
        sb.rpc("amarsoft_customer_capture", { p_start: r.start, p_end: r.end }),
        sb.from("amarsoft_salesmen").select("branch_code,sman,name,profile_id"),
        sb.from("branches").select("id,code,name").eq("is_active", true),
        db.from("eval_staff").select("*, branch:branches(name)").order("name"),
        db.from("staff_evaluations").select("*").eq("month", month),
      ]);
      if (ev.error) throw ev.error;
      return {
        rows: (ev.data ?? []) as EvalRow[],
        gold: (gold.error ? [] : gold.data ?? []) as GoldRow[],
        cap: (cap.error ? [] : cap.data ?? []) as CapRow[],
        sellers: (smen.error ? [] : smen.data ?? []) as Seller[],
        branches: (br.data ?? []) as { id: string; code: string; name: string }[],
        staff: ((staff.data ?? []) as (EvalStaff & { branch: { name: string } | null })[]).map((s) => ({ ...s, branch_name: s.branch?.name ?? null })),
        evals: (evals.data ?? []) as Evaluation[],
      };
    },
  });

  const blocks = useMemo<Block[]>(() => {
    const d = q.data;
    if (!d) return [];
    const codeOf = new Map(d.branches.map((b) => [b.id, b.code]));
    const nameOf = new Map(d.branches.map((b) => [b.code, b.name]));
    const k = (b: string, s: string) => `${b}|${s}`;

    // المبيعات لكل بائع (فرع|رقم)
    const sales = new Map<string, Sales>();
    const sellerName = new Map<string, string>();
    for (const r of d.rows) {
      const key = k(r.branch_code, r.sman);
      sellerName.set(key, r.salesman_name);
      if (!nameOf.has(r.branch_code)) nameOf.set(r.branch_code, r.branch_name);
      sales.set(key, plus(sales.get(key) ?? noSales(), { ...noSales(), grams: num(r.grams), invoices: num(r.invoices), lyd: num(r.amount) / 1000 }));
    }
    for (const g of d.gold) {
      const key = k(g.branch_code, g.sman);
      sales.set(key, plus(sales.get(key) ?? noSales(), { ...noSales(), goldLyd: num(g.gold_lyd), valuedLyd: num(g.amount_lyd) }));
    }
    for (const c of d.cap) {
      const key = k(c.branch_code, c.sman);
      sales.set(key, plus(sales.get(key) ?? noSales(), { ...noSales(), capInv: num(c.invoices), capBoth: num(c.with_both) }));
    }

    // التقييم (الشهر الحالي، من تقييمهم لبعض)
    const board = buildBoard(d.staff, d.evals, month, today);
    const people = board.people.map((p) => ({ id: p.id, name: p.name, branch_code: p.branch_id ? codeOf.get(p.branch_id) ?? null : null, profile_id: p.profile_id ?? null }));
    const sellers = [...new Set([...sales.keys(), ...d.sellers.map((s) => k(s.branch_code, s.sman))])].map((key) => {
      const [branch_code, sman] = key.split("|");
      const row = d.sellers.find((s) => s.branch_code === branch_code && s.sman === sman);
      return { branch_code, sman, name: sellerName.get(key) ?? row?.name ?? sman, profile_id: row?.profile_id ?? null };
    });
    const link = matchPeople(people, sellers);
    const linked = new Set(link.values());

    const codes = [...new Set([...d.branches.map((b) => b.code), ...[...sales.keys()].map((x) => x.split("|")[0])])].sort();
    return codes.map((code) => {
      const lines: Line[] = [];
      for (const p of board.people) {
        if ((p.branch_id ? codeOf.get(p.branch_id) : null) !== code) continue;
        const sk = link.get(p.id);
        lines.push({ key: `p:${p.id}`, name: p.name, role: p.role === "manager" ? "manager" : "employee", sales: sk ? sales.get(sk) ?? noSales() : null, person: p });
      }
      for (const s of sellers) {
        const key = k(s.branch_code, s.sman);
        const sl = sales.get(key);
        if (s.branch_code !== code || linked.has(key) || !sl || (!sl.grams && !sl.invoices)) continue;
        lines.push({ key: `s:${key}`, name: s.name, role: "seller", sales: sl, person: null });
      }
      const rank = (l: Line) => (l.role === "manager" ? 0 : l.role === "employee" ? 1 : 2);
      lines.sort((a, b) => rank(a) - rank(b) || (b.sales?.grams ?? -1) - (a.sales?.grams ?? -1));
      const total = [...sales.entries()].filter(([key]) => key.startsWith(`${code}|`)).reduce((a, [, v]) => plus(a, v), noSales());
      const finals = lines.map((l) => l.person?.final).filter((v): v is number => v != null);
      const mgr = lines.find((l) => l.role === "manager")?.person ?? null;
      const name = nameOf.get(code) ?? code;
      return {
        code, name, short: shortName(name), lines, sales: total,
        evalAvg: finals.length ? finals.reduce((a, b) => a + b, 0) / finals.length : null,
        duty: mgr?.duty ?? null, people: lines.filter((l) => l.person).length,
      };
    }).filter((b) => b.lines.length || b.sales.invoices);
  }, [q.data, month, today]);

  return { ...q, blocks, month };
}
