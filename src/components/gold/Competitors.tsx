// «المنافسين»: أسعار المحلات الثانية ما تتنشرش في أي موقع، فنسجّلوها إحنا لما نسمعوها أو نشوفوها
// (زبون قال، بوست، زيارة). كل سعر ينحسب «كم فوق الذهب الخام يومها» حتى نقدرو نقارنو سعر من أسبوعين
// بسعر اليوم، وبعدين نترجمو متوسطهم لسعر اليوم.
import { useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Store, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useGoldPrices } from "@/hooks/useGoldPrices";
import { useConfirm } from "@/components/ConfirmDialogProvider";
import { normalizeDecimalInput } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { sb, tripoliToday } from "@/lib/amarsoft";
import {
  competitorSummary, fmt, isMissingInDb, latestKasr, rawAt, signed, tripoliDay, useCompetitorPrices, useMarketQuotes, useRateSeries, type Karat,
} from "@/lib/goldMarket";

const DAYS = 90;
const dateAr = (iso: string) => new Intl.DateTimeFormat("ar-LY", { timeZone: "Africa/Tripoli", day: "numeric", month: "short" }).format(new Date(iso));

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={cn("rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-secondary")}>
      {children}
    </button>
  );
}

export default function Competitors() {
  const { user, roles } = useAuth();
  const isAdmin = roles.includes("admin");
  const qc = useQueryClient();
  const confirm = useConfirm();
  const comp = useCompetitorPrices(DAYS);
  const series = useRateSeries(DAYS + 10);
  const kasr = useMarketQuotes(7);
  const { data: declared } = useGoldPrices();

  const [shop, setShop] = useState("");
  const [area, setArea] = useState("");
  const [karat, setKarat] = useState<Karat>("18");
  const [kind, setKind] = useState<"sale" | "scrap">("sale");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const today = tripoliToday();
  const raw = (k: Karat) => (series.data ? rawAt(series.data, today, k) : null);
  const shops = useMemo(() => [...new Set((comp.data ?? []).map((r) => r.shop.trim()))].sort(), [comp.data]);
  const summaries = useMemo(() => (["18", "21"] as Karat[]).map((k) => ({
    k, s: competitorSummary(comp.data, series.data, k, series.data ? rawAt(series.data, today, k) : null),
    scrap: (comp.data ?? []).filter((r) => r.karat === k && r.kind === "scrap"),
  })), [comp.data, series.data, today]);

  if (comp.error && isMissingInDb(comp.error)) {
    return (
      <Card className="mx-auto max-w-3xl p-4 text-sm">
        <p className="font-bold">خانة المنافسين تحتاج تحديث قاعدة البيانات مرة وحدة</p>
        <p className="mt-1 text-muted-foreground">شغّل ملف <b>RUN_ONCE_2026-11-22.sql</b> في Supabase ← SQL Editor، وبعدين ارجع هنا.</p>
      </Card>
    );
  }

  const save = async () => {
    const p = Number(price);
    if (!shop.trim()) return toast.error("اكتب اسم المحل");
    if (!p || p < 50) return toast.error("اكتب سعر الجرام");
    const r = raw(karat);
    // غلطة شائعة: سعر عيار 21 ينكتب على 18 أو العكس، أو سعر القطعة بدل الجرام.
    if (r && (p < r * 0.85 || p > r * 2.5)) {
      const ok = await confirm({
        title: "السعر هذا غريب — متأكد؟",
        description: `جرام عيار ${karat} خام اليوم ${fmt(r)} د.ل، والسعر اللي كتبته ${fmt(p)} د.ل. تأكد من العيار وإنه سعر الجرام مش القطعة.`,
        confirmLabel: "متأكد، سجّله",
      });
      if (!ok) return;
    }
    setSaving(true);
    const { error } = await sb.from("competitor_prices").insert({
      shop: shop.trim(), area: area.trim() || null, karat, kind, price_per_gram: p, note: note.trim() || null,
    });
    setSaving(false);
    if (error) return toast.error(isMissingInDb(error) ? "شغّل ملف التحديث RUN_ONCE_2026-11-22.sql أول" : error.message);
    toast.success(`تسجّل سعر ${shop.trim()}`);
    setPrice(""); setNote("");
    qc.invalidateQueries({ queryKey: ["competitor-prices"] });
  };

  const remove = async (id: string, label: string) => {
    if (!(await confirm({ title: `نمسحو سعر ${label}؟`, confirmLabel: "امسح", destructive: true }))) return;
    const { error } = await sb.from("competitor_prices").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["competitor-prices"] });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <Card className="space-y-3 p-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold"><Store className="size-5 text-primary" />سجّل سعر منافس</h2>
          <p className="text-xs text-muted-foreground">أسعار المحلات الثانية ما تتنشرش في أي موقع — سجّل أي سعر تسمعه أو تشوفه (زبون قال، بوست، زيارة).</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">المحل</Label>
            <Input list="competitor-shops" placeholder="اسم المحل" value={shop} onChange={(e) => setShop(e.target.value)} />
            <datalist id="competitor-shops">{shops.map((s) => <option key={s} value={s} />)}</datalist>
          </div>
          <div>
            <Label className="text-xs">المنطقة (اختياري)</Label>
            <Input placeholder="مثلاً سوق المشير" value={area} onChange={(e) => setArea(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["18", "21", "24"] as Karat[]).map((k) => <Chip key={k} active={karat === k} onClick={() => setKarat(k)}>عيار {k}</Chip>)}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={kind === "sale"} onClick={() => setKind("sale")}>سعر بيع (جديد)</Chip>
          <Chip active={kind === "scrap"} onClick={() => setKind("scrap")}>شراء كسر (مستعمل)</Chip>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">سعر الجرام (د.ل)</Label>
            <Input inputMode="decimal" dir="ltr" placeholder={raw(karat) ? `الخام اليوم ${fmt(raw(karat))}` : ""} value={price}
              onChange={(e) => setPrice(normalizeDecimalInput(e.target.value))} />
          </div>
          <div>
            <Label className="text-xs">ملاحظة (اختياري)</Label>
            <Input placeholder="زبون قال / بوست / زيارة" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <Button className="w-full" disabled={saving} onClick={save}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} سجّل السعر
        </Button>
      </Card>

      {summaries.filter((x) => x.s.count > 0 || x.scrap.length > 0).map(({ k, s, scrap }) => {
        const mine = declared?.get(`${k}K`)?.price_per_gram ?? null;
        const r = raw(k);
        const lastScrap = scrap[0];
        const market = latestKasr(kasr.data, k);
        return (
          <Card key={k} className="space-y-2 p-3">
            <h3 className="font-bold">عيار {k} عند المنافسين <span className="text-xs font-normal text-muted-foreground">— آخر {DAYS} يوم: {s.count} سعر من {s.shops} محل</span></h3>
            {s.avgMargin !== null ? (
              <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-3">
                <div className="rounded-xl bg-gold-soft p-2">
                  <div className="text-[11px] text-muted-foreground">يبيعو اليوم تقريباً بـ</div>
                  <div className="text-xl font-extrabold tabular-nums text-primary">{fmt(s.todayAvg)}</div>
                  <div className="text-[11px] tabular-nums text-muted-foreground">من {fmt(s.todayMin)} لـ {fmt(s.todayMax)}</div>
                </div>
                <div className="rounded-xl border p-2">
                  <div className="text-[11px] text-muted-foreground">فوق الذهب الخام</div>
                  <div className="text-xl font-extrabold tabular-nums">{signed(s.avgMargin)}</div>
                  <div className="text-[11px] text-muted-foreground">د.ل للجرام (متوسط)</div>
                </div>
                <div className="col-span-2 rounded-xl border p-2 sm:col-span-1">
                  <div className="text-[11px] text-muted-foreground">سعرك المعلن (تسعير المحل)</div>
                  <div className="text-xl font-extrabold tabular-nums">{fmt(mine)}</div>
                  <div className="text-[11px] tabular-nums text-muted-foreground">
                    {mine !== null && r !== null ? `${signed(mine - r)} فوق الخام` : "—"}
                    {mine !== null && s.todayAvg !== null ? ` · ${mine >= s.todayAvg ? "أغلى" : "أرخص"} بـ ${fmt(Math.abs(mine - s.todayAvg))}` : ""}
                  </div>
                </div>
              </div>
            ) : s.count > 0 ? (
              <p className="text-xs text-muted-foreground">ما نقدروش نحسبو «فوق الخام» — ما فيش سعر دولار موازي لأيام الأسعار هذي.</p>
            ) : null}
            {lastScrap && (
              <p className="text-xs text-muted-foreground">
                آخر سعر شراء كسر عند منافس: <b className="text-foreground">{fmt(Number(lastScrap.price_per_gram))}</b> ({lastScrap.shop}، {dateAr(lastScrap.created_at)})
                {market ? <> — كسر السوق اليوم {fmt(market.value)}</> : null}
              </p>
            )}
          </Card>
        );
      })}

      <Card className="space-y-2 p-3">
        <h3 className="font-bold">كل الأسعار المسجّلة</h3>
        {comp.isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin text-primary" /></div>
        ) : !(comp.data ?? []).length ? (
          <p className="py-4 text-center text-sm text-muted-foreground">ما فيش أسعار مسجّلة بعد — أول ما تسجّل سعر يطلع هنا.</p>
        ) : (
          <ul className="divide-y">
            {(comp.data ?? []).map((r) => {
              const rr = series.data ? rawAt(series.data, tripoliDay(r.created_at), r.karat) : null;
              const canDelete = isAdmin || r.recorded_by === user?.id;
              return (
                <li key={r.id} className="flex items-start gap-2 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{r.shop}{r.area ? <span className="font-normal text-muted-foreground"> · {r.area}</span> : null}</p>
                    <p className="text-[11px] text-muted-foreground">
                      عيار {r.karat} · {r.kind === "sale" ? "سعر بيع" : "شراء كسر"} · {dateAr(r.created_at)}{r.who?.full_name ? ` · ${r.who.full_name}` : ""}
                    </p>
                    {r.note && <p className="text-xs">{r.note}</p>}
                  </div>
                  <div className="shrink-0 text-left">
                    <p className="font-extrabold tabular-nums">{fmt(Number(r.price_per_gram))} <span className="text-[10px] font-normal">د.ل/جم</span></p>
                    {rr !== null && <p className="text-[11px] tabular-nums text-muted-foreground">{signed(Number(r.price_per_gram) - rr)} فوق الخام يومها</p>}
                  </div>
                  {canDelete && (
                    <button className="p-1 text-muted-foreground hover:text-destructive" aria-label="امسح" onClick={() => remove(r.id, r.shop)}>
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
