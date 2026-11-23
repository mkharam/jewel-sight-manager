// ربط موظف التقييم (eval_staff) ببائع أمارسوفت (رقم sman في فرعه) — باش صفحة «الفروع والفريق» توري
// مبيعاته وتقييمه في سطر واحد. ما فيش عمود يربطهم، فنربطوا بالترتيب:
//  1) نفس حساب التطبيق (profile_id في الاثنين).
//  2) نفس الاسم كامل (بعد توحيد الحروف).
//  3) نفس أول اسم — لو وحيد في الفرع («علي» ↔ «علي عمورة»).
//  4) أسماء أمارسوفت اللاتينية: نفس هيكل الحروف الساكنة («MALEK» ↔ «مالك»، «MOAD» ↔ «معاد»).
// كله داخل نفس الفرع بس، والبيعات المشتركة («اشرف و محمد»، «بيعة مشتركة»، «SHOP») ما تتربطش بحد.
import { normalizeAr } from "@/lib/arabic-search";

/** «عبد الرحمن» = «عبدالرحمن»، و«ال» في الأول ما تفرقش. */
const joinAbd = (s: string) => s.replace(/(^|\s)عبد\s+/g, "$1عبد");
export const fullKey = (name: string) => joinAbd(normalizeAr(name)).replace(/\s+/g, " ").trim();
export const firstWord = (name: string) => fullKey(name).split(" ")[0] ?? "";

const AR: Record<string, string> = {
  "ب": "B", "ت": "T", "ث": "T", "ج": "J", "ح": "H", "خ": "K", "د": "D", "ذ": "D", "ر": "R", "ز": "Z", "س": "S", "ش": "S",
  "ص": "S", "ض": "D", "ط": "T", "ظ": "Z", "غ": "J", "ف": "F", "ق": "K", "ك": "K", "ل": "L", "م": "M", "ن": "N", "ه": "H",
};
const LAT: Record<string, string> = { C: "K", G: "J", Q: "K", P: "B", V: "F", X: "KS" };

/** هيكل الحروف الساكنة بلا حروف علة (عربي ولا لاتيني): «AHMED» و«احمد» ← HMD. */
export function skeleton(name: string): string {
  const s = name.trim().toUpperCase()
    .replace(/SH/g, "S").replace(/KH/g, "K").replace(/TH/g, "T").replace(/DH/g, "D").replace(/GH/g, "J").replace(/PH/g, "F");
  let out = "";
  for (const ch of s) {
    if (AR[ch] !== undefined) out += AR[ch];
    else if (/[BCDFGHJKLMNPQRSTVXZ]/.test(ch)) out += LAT[ch] ?? ch;
  }
  return out.replace(/(.)\1+/g, "$1");
}

const isLatin = (s: string) => /[A-Za-z]/.test(s);
/** بيعة مشتركة («اشرف و محمد»، «بيعة مشتركة») ولا حساب المحل — مش شخص. */
export const isShared = (name: string) => /\sو\s|مشترك|^محل$|^shop$|^store$/i.test(name.trim());

export type SalesKey = { branch_code: string; sman: string; name: string; profile_id?: string | null };
export type EvalPerson = { id: string; name: string; branch_code: string | null; profile_id?: string | null };

/** يرجّع لكل موظف تقييم (id) بائع أمارسوفت المربوط بيه (branch_code|sman) — بلا تكرار. */
export function matchPeople(people: EvalPerson[], sellers: SalesKey[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  const key = (s: SalesKey) => `${s.branch_code}|${s.sman}`;
  const inBranch = (p: EvalPerson) => sellers.filter((s) => s.branch_code === p.branch_code && !used.has(key(s)));
  const take = (p: EvalPerson, s: SalesKey) => { out.set(p.id, key(s)); used.add(key(s)); };
  const pending = () => people.filter((p) => p.branch_code && !out.has(p.id));

  // 1) نفس حساب التطبيق
  for (const p of pending()) {
    const hit = p.profile_id ? inBranch(p).find((s) => s.profile_id === p.profile_id) : undefined;
    if (hit) take(p, hit);
  }
  // 2) نفس الاسم كامل · 3) نفس أول اسم (لو وحيد) · 4) هيكل الحروف للأسماء اللاتينية (لو وحيد)
  const rules: ((p: EvalPerson, s: SalesKey) => boolean)[] = [
    (p, s) => fullKey(p.name) === fullKey(s.name),
    (p, s) => !isShared(s.name) && !isLatin(s.name) && firstWord(p.name) === firstWord(s.name),
    (p, s) => !isShared(s.name) && isLatin(s.name) !== isLatin(p.name) && skeleton(firstWord(p.name)).length >= 2
      && skeleton(firstWord(p.name)) === skeleton(s.name.trim().split(/\s+/)[0] ?? ""),
  ];
  for (const rule of rules) {
    for (const p of pending()) {
      const hits = inBranch(p).filter((s) => rule(p, s));
      // أكثر من موظف ينطبق عليه نفس البائع؟ ما نربطوش (نخلّوه للمدير يشوفه).
      const rivals = hits.length === 1 ? pending().filter((o) => o !== p && o.branch_code === p.branch_code && rule(o, hits[0])) : [];
      if (hits.length === 1 && rivals.length === 0) take(p, hits[0]);
    }
  }
  return out;
}
