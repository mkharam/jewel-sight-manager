// طابور إدخال الأوزان.
//
// ٣٤٦ قطعة من ٤٧٣ في المتجر بلا وزن، والوزن هو أساس تسعير الذهب — فالقطعة بلا وزن لا
// يستطيع الموظف أن يعطي فيها سعراً لزبون واقف أمامه. إدخال الوزن كان متاحاً داخل صفحة
// كل قطعة على حدة: افتح، انزل لأسفل، اكتب، ارجع… ثلاث مئة مرة. هنا صفّ واحد لكل قطعة
// بحقل رقم كبير، والحفظ ينقل التركيز للقطعة التالية تلقائياً فلا تُرفع اليد عن الشاشة.
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Scale, Loader2, Check, ImageIcon, ExternalLink } from "lucide-react";
import { getThumbUrl, normalizeDecimalInput } from "@/lib/constants";
import { invalidateInventoryAndSales } from "@/lib/queryInvalidation";
import { toast } from "sonner";

const PAGE_SIZE = 40;

export default function MissingWeights() {
  const qc = useQueryClient();
  const { profile, roles } = useAuth();
  const isAdmin = roles.includes("admin");
  const branchId = profile?.branch_id ?? null;

  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, number>>({});
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ["missing-weights", branchId, isAdmin],
    queryFn: async () => {
      // الموظف يزن بضاعة فرعه — لا معنى لأن يزن قطعة في محل آخر لا يراها.
      let q = supabase
        .from("products")
        .select("id, name, sku, karat, branch:branches(name), images:product_images(storage_path,thumb_path,is_primary)", { count: "exact" })
        .is("weight_grams", null)
        .eq("status", "available")
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (!isAdmin && branchId) q = q.eq("branch_id", branchId);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: data ?? [], total: count ?? 0 };
    },
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  const save = async (id: string, index: number) => {
    const raw = (values[id] ?? "").trim();
    const grams = Number(raw);
    if (!raw || !isFinite(grams) || grams <= 0) return toast.error("اكتب وزناً صحيحاً");
    setSaving(id);
    // نفس الدالة التي تستعملها صفحة القطعة — تفحص الصلاحية داخل قاعدة البيانات.
    const { error } = await supabase.rpc("update_product_weight", {
      p_product_id: id,
      p_weight_grams: grams,
    });
    setSaving(null);
    if (error) return toast.error(error.message);

    setDone((d) => ({ ...d, [id]: grams }));
    // لا نُعيد جلب القائمة فوراً: اختفاء الصفوف تحت إصبع الموظف وهو يكتب أسوأ من بقائها
    // معلَّمة بعلامة صح. الكتالوج وبقية الشاشات تتحدّث الآن، وهذه القائمة عند الخروج.
    invalidateInventoryAndSales(qc);
    inputs.current[index + 1]?.focus();
  };

  const savedCount = Object.keys(done).length;

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Scale className="size-6 text-primary" /> قطع بلا وزن
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          الوزن أساس تسعير الذهب — بدونه لا يمكن إعطاء سعر لزبون. اكتب الوزن واضغط التالي.
        </p>
      </div>

      <Card className="px-3 py-2 bg-gold-soft border-primary/20 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          {isLoading ? "…" : total} قطعة بلا وزن{" "}
          {!isAdmin && branchId && <span className="text-xs text-muted-foreground">في فرعك</span>}
        </p>
        {savedCount > 0 && (
          <span className="text-xs font-bold text-primary flex items-center gap-1">
            <Check className="size-3.5" /> وزنت {savedCount}
          </span>
        )}
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
      ) : rows.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-12">
          ما في قطعة بلا وزن — كل البضاعة موزونة 🎉
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((p: any, i: number) => {
            const img = getThumbUrl(p.images?.find((x: any) => x.is_primary) ?? p.images?.[0]);
            const savedGrams = done[p.id];
            return (
              <Card key={p.id} className={`p-2.5 flex items-center gap-2.5 ${savedGrams ? "opacity-60" : ""}`}>
                <div className="size-14 rounded-lg overflow-hidden bg-gold-soft shrink-0 flex items-center justify-center">
                  {img ? (
                    <img src={img} alt="" className="size-full object-cover" loading="lazy" />
                  ) : (
                    <ImageIcon className="size-5 text-muted-foreground" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <Link to={`/products/${p.id}`} className="text-sm font-semibold leading-tight line-clamp-2 hover:text-primary">
                    {p.name}
                    <ExternalLink className="size-3 inline mr-1 opacity-50" />
                  </Link>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {p.sku} {p.karat && `· ${p.karat}`} {isAdmin && p.branch?.name && `· ${p.branch.name}`}
                  </p>
                </div>

                {savedGrams ? (
                  <span className="text-sm font-bold text-primary shrink-0 flex items-center gap-1">
                    <Check className="size-4" /> {savedGrams} غ
                  </span>
                ) : (
                  <div className="flex gap-1.5 shrink-0">
                    {/* type="text" لا number: لوحة المفاتيح العربية تكتب أرقاماً هندية
                        يرفضها حقل الأرقام بصمت. راجع normalizeDecimalInput. */}
                    <Input
                      ref={(el) => { inputs.current[i] = el; }}
                      type="text"
                      inputMode="decimal"
                      dir="ltr"
                      placeholder="غرام"
                      value={values[p.id] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [p.id]: normalizeDecimalInput(e.target.value) }))}
                      onKeyDown={(e) => { if (e.key === "Enter") void save(p.id, i); }}
                      className="w-24 h-11 text-center font-bold"
                    />
                    <Button
                      size="icon"
                      variant="outline"
                      className="size-11 shrink-0"
                      onClick={() => save(p.id, i)}
                      disabled={saving === p.id}
                      aria-label="حفظ الوزن"
                    >
                      {saving === p.id ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}

          {total > rows.length && (
            <p className="text-center text-xs text-muted-foreground py-3">
              تُعرض {rows.length} قطعة في المرة. احفظ هذه ثم حدّث الصفحة للدفعة التالية.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
