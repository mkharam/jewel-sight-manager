// أسعار السوق من تطبيق «بكم»: الذهب الخارجي (سعر جرام الذهب المستورد المشغول في السوق) والمسبوك
// ما يتنشروش مجاناً في أي موقع، و«بكم» اشتراك مدفوع — فالمدير يشوفهم في التطبيق ويسجّلهم هنا في دقيقة.
// الكسر يتجاب وحده من الأخبار، بس لو كتبته هنا يتسجّل برضو (الأحدث هو اللي يبان).
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useConfirm } from "@/components/ConfirmDialogProvider";
import { normalizeDecimalInput } from "@/lib/constants";
import { formatTripoli, sb } from "@/lib/amarsoft";
import { fmt, isMissingInDb, quoteOf, type MarketRow, type QuoteField } from "@/lib/goldMarket";

const FIELDS: { f: QuoteField; label: string; karat: number }[] = [
  { f: "kharji18", label: "ذهب خارجي 18", karat: 18 },
  { f: "kharji21", label: "ذهب خارجي 21", karat: 21 },
  { f: "kasr18", label: "ذهب كسر 18", karat: 18 },
  { f: "kasr21", label: "ذهب كسر 21", karat: 21 },
  { f: "masbook18", label: "ذهب مسبوك 18", karat: 18 },
  { f: "masbook24", label: "ذهب مسبوك 24", karat: 24 },
];

export default function BekamQuotes({ rows, g24, error }: { rows: MarketRow[] | undefined; g24: number | null; error: unknown }) {
  const { user, roles } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Partial<Record<QuoteField, string>>>({});
  const [saving, setSaving] = useState(false);

  const last = rows?.find((r) => r.source === "bekam");
  const canDelete = !!last && (roles.includes("admin") || last.recorded_by === user?.id);

  const save = async () => {
    const entry: Partial<Record<QuoteField, number>> = {};
    for (const { f } of FIELDS) if (vals[f]?.trim()) entry[f] = Number(vals[f]);
    if (!Object.keys(entry).length) return toast.error("اكتب سعر واحد على الأقل");
    // غلطة شائعة: رقم في الخانة الغلط (21 في 18) ولا سعر ليرة/أوقية بدل الجرام.
    const odd = FIELDS.filter(({ f, karat }) => entry[f] !== undefined && g24 && (entry[f]! < g24 * (karat / 24) * 0.8 || entry[f]! > g24 * (karat / 24) * 2.2));
    if (odd.length && !(await confirm({
      title: "فيه سعر غريب — متأكد؟",
      description: `${odd.map((o) => o.label).join("، ")}: بعيد واجد على قيمة الذهب الخام اليوم. تأكد إنه سعر الجرام وفي الخانة الصح.`,
      confirmLabel: "متأكد، سجّل",
    }))) return;
    setSaving(true);
    const { error: e } = await sb.from("ly_gold_market").insert({
      url: `manual:${crypto.randomUUID()}`, observed_at: new Date().toISOString(), source: "bekam", ...entry,
    });
    setSaving(false);
    if (e) return toast.error(isMissingInDb(e) || e.code === "42703" ? "شغّل ملف التحديث RUN_ONCE_2026-11-22.sql (النسخة الجديدة) أول" : e.message);
    toast.success("تسجّلت أسعار السوق");
    setVals({}); setOpen(false);
    qc.invalidateQueries({ queryKey: ["ly-gold-market"] });
  };

  const remove = async () => {
    if (!last || !(await confirm({ title: "نمسحو آخر تسجيل من «بكم»؟", confirmLabel: "امسح", destructive: true }))) return;
    const { error: e } = await sb.from("ly_gold_market").delete().eq("url", last.url);
    if (e) return toast.error(e.message);
    qc.invalidateQueries({ queryKey: ["ly-gold-market"] });
  };

  return (
    <Card className="space-y-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-bold">أسعار السوق من «بكم»</h2>
          <p className="text-xs text-muted-foreground">الذهب الخارجي والمسبوك ما يتنشروش مجاناً — لما تشوفهم في تطبيق بكم سجّلهم هنا.</p>
        </div>
        <Button size="sm" variant={open ? "secondary" : "default"} className="shrink-0" onClick={() => setOpen((o) => !o)}>
          {open ? "إخفاء" : "سجّل أسعار اليوم"}
        </Button>
      </div>

      {last ? (
        <div className="space-y-1">
          <div className="grid grid-cols-3 gap-1.5 text-center sm:grid-cols-6">
            {FIELDS.map(({ f, label }) => (
              <div key={f} className="rounded-lg border p-1.5">
                <div className="text-[10px] text-muted-foreground">{label}</div>
                <div className="font-bold tabular-nums">{fmt(quoteOf(last, f))}</div>
              </div>
            ))}
          </div>
          <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
            آخر تسجيل: {formatTripoli(last.observed_at)}
            {canDelete && <button className="inline-flex items-center gap-0.5 hover:text-destructive" onClick={remove}><Trash2 className="size-3" />امسح</button>}
          </p>
        </div>
      ) : !error ? (
        <p className="text-xs text-muted-foreground">ما فيش أسعار مسجّلة من بكم بعد.</p>
      ) : null}

      {open && (
        <div className="space-y-2 rounded-xl border border-primary/40 p-2.5">
          <div className="grid grid-cols-2 gap-2">
            {FIELDS.map(({ f, label }) => (
              <div key={f}>
                <Label className="text-xs">{label}</Label>
                <Input inputMode="decimal" dir="ltr" value={vals[f] ?? ""} placeholder={last && quoteOf(last, f) ? fmt(quoteOf(last, f)) : "—"}
                  onChange={(e) => setVals((v) => ({ ...v, [f]: normalizeDecimalInput(e.target.value) }))} />
              </div>
            ))}
          </div>
          <Button className="w-full" disabled={saving} onClick={save}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} حفظ (سعر الجرام بالدينار)
          </Button>
        </div>
      )}
    </Card>
  );
}
