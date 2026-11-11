// قطع الطاقم داخل صفحة القطعة: كل قطعة بصورتها وحالتها. عند بيع قطعة منفردة (تُفوتر في
// أمارسوفت بالكود العام 18K GEN) يعلّمها الموظف «بيعت» ويربطها بسطر الفاتورة، فيظهر الطاقم
// «ناقصاً» مع ما بقي منه ووزنه. راجع migration 20261112090000_product_set_parts.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Layers, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { getThumbUrl, normalizeDecimalInput } from "@/lib/constants";

type Part = {
  id: string; product_id: string; image_id: string | null; position: number; name: string;
  weight_grams: number | null; status: "available" | "sold"; sold_at: string | null;
  sale_ref: { invoice_id: number; invoice_no: string; invoice_date: string; line: number; grams: number; descr: string } | null;
};
type Candidate = { invoice_id: number; invoice_no: string; invoice_date: string; line: number; grams: number; descr: string; sman: string };
type Img = { id: string; storage_path: string; thumb_path: string | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function useSetParts(productId: string | undefined) {
  return useQuery({
    queryKey: ["set-parts", productId],
    enabled: !!productId,
    queryFn: async (): Promise<Part[]> => {
      const { data, error } = await db.from("product_set_parts").select("*").eq("product_id", productId).order("position");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export default function SetPartsCard({ productId, images, isSetType, canEdit, totalWeight }: {
  productId: string; images: Img[]; isSetType: boolean; canEdit: boolean; totalWeight: number | null;
}) {
  const qc = useQueryClient();
  const { data: parts = [], isLoading } = useSetParts(productId);
  const [selling, setSelling] = useState<Part | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["set-parts", productId] });

  if (isLoading) return null;
  if (!parts.length && !isSetType) return null;

  const imgOf = (p: Part) => images.find((i) => i.id === p.image_id);
  const sold = parts.filter((p) => p.status === "sold");
  const soldGrams = sold.reduce((s, p) => s + Number(p.sale_ref?.grams ?? p.weight_grams ?? 0), 0);

  const createFromImages = async () => {
    if (!images.length) return toast.error("أضف صور قطع الطاقم أولاً");
    setBusy(true);
    const { error } = await db.from("product_set_parts").insert(
      images.map((img, i) => ({ product_id: productId, image_id: img.id, position: i, name: `قطعة ${i + 1}` })),
    );
    setBusy(false);
    if (error) return toast.error("تعذّر إنشاء قطع الطاقم");
    toast.success("تم — سمِّ كل قطعة ثم علّم المباع منها");
    refresh();
  };

  const patch = async (id: string, values: Record<string, unknown>) => {
    const { error } = await db.from("product_set_parts").update(values).eq("id", id);
    if (error) { toast.error("تعذّر الحفظ"); return false; }
    refresh();
    return true;
  };

  const openSell = async (p: Part) => {
    setSelling(p);
    setCandidates(null);
    const { data } = await db.rpc("set_part_sale_candidates", { p_product_id: productId, p_days: 14 });
    const list: Candidate[] = data ?? [];
    // الأقرب وزناً أولاً إن كان للقطعة وزن.
    if (p.weight_grams) list.sort((a, b) => Math.abs(a.grams - p.weight_grams!) - Math.abs(b.grams - p.weight_grams!));
    setCandidates(list);
  };

  const markSold = async (c: Candidate | null) => {
    if (!selling) return;
    const { data: u } = await supabase.auth.getUser();
    const ok = await patch(selling.id, {
      status: "sold",
      sold_at: new Date().toISOString(),
      sold_by: u.user?.id ?? null,
      sale_ref: c ? { invoice_id: c.invoice_id, invoice_no: c.invoice_no, invoice_date: c.invoice_date, line: c.line, grams: c.grams, descr: c.descr } : null,
      ...(c && !selling.weight_grams ? { weight_grams: c.grams } : {}),
    });
    if (ok) { toast.success(`«${selling.name}» بيعت — الطاقم صار ناقصاً`); setSelling(null); }
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Layers className="size-5 text-primary" />
        <h2 className="font-bold">قطع الطاقم</h2>
        {sold.length > 0 && <Badge variant="destructive">ناقص — بيعت {sold.length} من {parts.length}</Badge>}
      </div>

      {!parts.length ? (
        canEdit && (
          <Button variant="outline" className="w-full" onClick={() => void createFromImages()} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin ml-2" />} قسّم الطاقم: كل صورة قطعة ({images.length})
          </Button>
        )
      ) : (
        <>
          <div className="space-y-2">
            {parts.map((p) => {
              const img = imgOf(p);
              return (
                <div key={p.id} className={`flex items-center gap-2 rounded-lg border p-2 ${p.status === "sold" ? "opacity-60" : ""}`}>
                  {img ? <img src={getThumbUrl(img)!} alt="" className="size-12 rounded-md object-cover" />
                    : <div className="size-12 rounded-md bg-muted" />}
                  <div className="flex-1 min-w-0 space-y-1">
                    <input defaultValue={p.name} disabled={!canEdit} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== p.name) void patch(p.id, { name: v }); }}
                      className="w-full bg-transparent text-sm font-semibold outline-none focus:border-b" />
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input inputMode="decimal" placeholder="الوزن" defaultValue={p.weight_grams ?? ""} disabled={!canEdit}
                        onBlur={(e) => { const w = parseFloat(normalizeDecimalInput(e.target.value)); const nv = isNaN(w) ? null : w; if (nv !== p.weight_grams) void patch(p.id, { weight_grams: nv }); }}
                        className="w-16 rounded border bg-transparent px-1 text-center" /> جم
                      {p.status === "sold" && (
                        <span className="text-destructive">بيعت{p.sale_ref ? ` — فاتورة ${p.sale_ref.invoice_no} (${p.sale_ref.grams} جم)` : ""}</span>
                      )}
                    </div>
                  </div>
                  {canEdit && (p.status === "available" ? (
                    <Button size="sm" variant="outline" onClick={() => void openSell(p)}>بيعت</Button>
                  ) : (
                    <Button size="sm" variant="ghost" title="إلغاء البيع" onClick={() => void patch(p.id, { status: "available", sold_at: null, sold_by: null, sale_ref: null })}>
                      <Undo2 className="size-4" />
                    </Button>
                  ))}
                </div>
              );
            })}
          </div>
          {sold.length > 0 && (
            <p className="rounded-lg bg-amber-500/10 p-2 text-xs text-amber-800">
              الباقي: {parts.length - sold.length} قطع
              {totalWeight ? ` — الوزن الباقي تقريباً ${(totalWeight - soldGrams).toFixed(2)} جم من ${totalWeight} جم` : ""}.
              عدّل وزن الطاقم في أمارسوفت ليطابق الباقي.
            </p>
          )}
        </>
      )}

      <Dialog open={!!selling} onOpenChange={(o) => !o && setSelling(null)}>
        <DialogContent dir="rtl" className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>بيع «{selling?.name}» من الطاقم</DialogTitle>
            <DialogDescription>اختر سطر الفاتورة (الكود العام) الذي فُوترت به القطعة — آخر 14 يوماً في هذا الفرع.</DialogDescription>
          </DialogHeader>
          {candidates === null ? (
            <Loader2 className="mx-auto size-6 animate-spin" />
          ) : (
            <div className="space-y-2">
              {candidates.length === 0 && <p className="text-sm text-muted-foreground">لا توجد سطور بيع بالكود العام مؤخراً (قد لم تتزامن الفاتورة بعد).</p>}
              {candidates.map((c) => (
                <button key={`${c.invoice_id}-${c.line}`} onClick={() => void markSold(c)}
                  className="w-full rounded-lg border p-2 text-right text-sm hover:bg-muted">
                  <b>{c.grams} جم</b> — {c.descr || "بدون وصف"}
                  <span className="block text-xs text-muted-foreground">فاتورة {c.invoice_no} · {c.invoice_date}{c.sman ? ` · بائع ${c.sman}` : ""}</span>
                </button>
              ))}
              <Button variant="secondary" className="w-full" onClick={() => void markSold(null)}>علّمها مباعة بدون ربط بفاتورة</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
