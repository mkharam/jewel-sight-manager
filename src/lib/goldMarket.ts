// سوق الذهب: سعر الأونصة والدولار يوم بيوم (market_rates)، سعر الكسر في سوق طرابلس (ly_gold_market)،
// وأسعار المنافسين (competitor_prices). كل المقارنات تصير بـ«كم فوق الذهب الخام في نفس اليوم» — لأن
// الذهب يطلع وينزل كل يوم، وسعر منافس من أسبوعين ما ينقارنش بسعر اليوم مباشرة.
import { useQuery } from "@tanstack/react-query";
import { sb, addDays, tripoliToday } from "@/lib/amarsoft";

export const GRAMS_PER_OZ = 31.1035;
export type Karat = "18" | "21" | "24";
export const PURITY: Record<Karat, number> = { "18": 0.75, "21": 0.875, "24": 1 };

/** يوم واحد بعد ملء الفراغات: الأونصة من آخر يوم معروف، والدولار الموازي من آخر 10 أيام بس
 *  (أقدم من هيك نقولو «ما نعرفش» بدل رقم غلط). g24 = قيمة جرام الذهب الصافي بالدينار. */
export type RateDay = { day: string; xau: number | null; usd: number | null; official: number | null; g24: number | null };

type RawRate = { day: string; xau_usd_oz: number | null; usd_lyd_market: number | null; usd_lyd_official: number | null };

const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

export function buildSeries(rows: RawRate[]): RateDay[] {
  const out: RateDay[] = [];
  let xau: number | null = null, usd: number | null = null, usdDay = "", official: number | null = null;
  for (const r of rows) {
    if (n(r.xau_usd_oz)) xau = n(r.xau_usd_oz);
    if (n(r.usd_lyd_market)) { usd = n(r.usd_lyd_market); usdDay = r.day; }
    if (n(r.usd_lyd_official)) official = n(r.usd_lyd_official);
    const usdOk = usd !== null && usdDay >= addDays(r.day, -10) ? usd : null;
    out.push({ day: r.day, xau, usd: usdOk, official, g24: xau && usdOk ? (xau / GRAMS_PER_OZ) * usdOk : null });
  }
  return out;
}

/** قيمة جرام الذهب الخام لعيار في يوم (آخر يوم معروف قبله أو فيه). */
export function rawAt(series: RateDay[], day: string, karat: Karat): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].day <= day) return series[i].g24 === null ? null : series[i].g24! * PURITY[karat];
  }
  return null;
}

/** الأونصة والدولار يوم بيوم لآخر `days` يوم (ومعاها 15 يوم زيادة باش نملو الفراغ في الأول). */
export function useRateSeries(days: number) {
  return useQuery({
    queryKey: ["rate-series", days],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const since = addDays(tripoliToday(), -(days + 15));
      const { data, error } = await sb.from("market_rates")
        .select("day, xau_usd_oz, usd_lyd_market, usd_lyd_official")
        .gte("day", since).order("day", { ascending: true });
      if (error) throw error;
      return buildSeries((data ?? []) as RawRate[]);
    },
  });
}

/** أسعار السوق: الكسر (تلقائي من الأخبار) + الذهب الخارجي والمسبوك (يسجّلها المدير من تطبيق «بكم»). */
export type MarketRow = {
  url: string; observed_at: string; source: string; recorded_by?: string | null;
  kasr18: number | null; kasr21: number | null; kasr24: number | null;
  kharji18?: number | null; kharji21?: number | null; masbook18?: number | null; masbook24?: number | null;
};
export type QuoteField = "kasr18" | "kasr21" | "kasr24" | "kharji18" | "kharji21" | "masbook18" | "masbook24";
const QUOTE_FIELDS: QuoteField[] = ["kasr18", "kasr21", "kasr24", "kharji18", "kharji21", "masbook18", "masbook24"];
export const kasrField = (k: Karat): QuoteField => (k === "18" ? "kasr18" : k === "21" ? "kasr21" : "kasr24");
export const kharjiField = (k: Karat): QuoteField | null => (k === "18" ? "kharji18" : k === "21" ? "kharji21" : null);
export const quoteOf = (r: MarketRow, f: QuoteField) => n(r[f]);
export const kasrOf = (r: MarketRow, k: Karat) => quoteOf(r, kasrField(k));

/** أسعار السوق (أحدث أول). لو ملف التحديث القديم بس اللي تشغّل (بلا أعمدة «بكم») نجيبو الكسر وحده. */
export function useMarketQuotes(days: number) {
  return useQuery({
    queryKey: ["ly-gold-market", days],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const q = (cols: string) => sb.from("ly_gold_market").select(cols)
        .gte("observed_at", since).order("observed_at", { ascending: false }).limit(400);
      let { data, error } = await q("url, observed_at, source, recorded_by, kasr18, kasr21, kasr24, kharji18, kharji21, masbook18, masbook24");
      if (error && (error.code === "42703" || /column/i.test(error.message ?? ""))) {
        ({ data, error } = await q("url, observed_at, kasr18, kasr21, kasr24"));
      }
      if (error) throw error;
      return ((data ?? []) as MarketRow[]).filter((r) => QUOTE_FIELDS.some((f) => quoteOf(r, f) !== null));
    },
  });
}

/** أحدث قيمة لسعر من أسعار السوق. */
export function latestQuote(rows: MarketRow[] | undefined, f: QuoteField | null) {
  if (!f) return null;
  const r = rows?.find((x) => quoteOf(x, f) !== null);
  return r ? { value: quoteOf(r, f)!, at: r.observed_at, source: r.source ?? "libyaakhbar" } : null;
}
export const latestKasr = (rows: MarketRow[] | undefined, k: Karat) => latestQuote(rows, kasrField(k));

export type CompetitorRow = {
  id: string; created_at: string; shop: string; area: string | null; karat: Karat; kind: "sale" | "scrap";
  price_per_gram: number; note: string | null; recorded_by: string | null; who?: { full_name: string | null } | null;
};

export function useCompetitorPrices(days: number) {
  return useQuery({
    queryKey: ["competitor-prices", days],
    retry: false,
    queryFn: async () => {
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const { data, error } = await sb.from("competitor_prices")
        .select("*, who:profiles(full_name)")
        .gte("created_at", since).order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []) as CompetitorRow[];
    },
  });
}

/** يوم السعر بتوقيت طرابلس. */
export const tripoliDay = (iso: string) => tripoliToday(new Date(iso));

/** الجدول/الدالة ما زالت ما انعملتش في قاعدة البيانات (ملف التحديث ما تشغّلش). */
export function isMissingInDb(err: unknown) {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  return ["PGRST202", "PGRST205", "42P01", "42883"].includes(e.code ?? "")
    || /could not find the (function|table)|does not exist/i.test(e.message ?? "");
}

/** المنافسين في عيار: كل سعر بيع محسوب «فوق الخام يومها»، ومتوسطهم مترجم لسعر اليوم. */
export function competitorSummary(rows: CompetitorRow[] | undefined, series: RateDay[] | undefined, karat: Karat, rawToday: number | null) {
  const list = (rows ?? []).filter((r) => r.karat === karat && r.kind === "sale").map((r) => {
    const raw = series ? rawAt(series, tripoliDay(r.created_at), karat) : null;
    return { ...r, price: Number(r.price_per_gram), raw, margin: raw === null ? null : Number(r.price_per_gram) - raw };
  });
  const withMargin = list.filter((r) => r.margin !== null);
  if (!withMargin.length) return { list, count: list.length, shops: 0, avgMargin: null, todayAvg: null, todayMin: null, todayMax: null };
  const margins = withMargin.map((r) => r.margin!);
  const avgMargin = margins.reduce((a, b) => a + b, 0) / margins.length;
  return {
    list, count: list.length, shops: new Set(withMargin.map((r) => r.shop.trim())).size, avgMargin,
    todayAvg: rawToday === null ? null : rawToday + avgMargin,
    todayMin: rawToday === null ? null : rawToday + Math.min(...margins),
    todayMax: rawToday === null ? null : rawToday + Math.max(...margins),
  };
}

export const fmt = (v: number | null | undefined, d = 0) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: d });
export const signed = (v: number | null | undefined, d = 0) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt(Math.abs(v), d)}`;
