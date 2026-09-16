import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Coins, Save, AlertTriangle, Eye, EyeOff } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useShowPricesSetting } from "@/hooks/useAppSettings";
import { KARAT_OPTIONS, formatCurrency, formatDate } from "@/lib/constants";
import { suggestedPrice } from "@/lib/luxury";
import { toast } from "sonner";

// عيارات المتجر تُؤخذ من KARAT_OPTIONS كبقية الشاشات — كانت هنا قائمة مستقلة تضيف
// ٢٢K و٢٤K وهما غير موجودين في المحل، فسُجّل سعر ٢٢K بالخطأ وبقيت قطع ٢١K بلا سعر.
const KARATS = KARAT_OPTIONS;

export default function GoldPrice() {
  const { user, roles, rolesLoading } = useAuth();
  const qc = useQueryClient();
  // سعر الذهب: المدير العام والمشرف فقط — ليس الموظف.
  const canEdit = roles.includes("admin") || roles.includes("manager");
  const [form, setForm] = useState<Record<string, { price: string; making: string }>>({});
  const [weight, setWeight] = useState("");
  const [calcKarat, setCalcKarat] = useState("21K");

  const { data: prices = [] } = useQuery({
    queryKey: ["gold-prices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gold_prices")
        .select("*, staff:profiles(full_name)")
        .order("effective_date", { ascending: false })
        .limit(60);
      if (error) throw error;
      return data ?? [];
    },
  });

  // آخر سعر لكل عيار
  const latest = useMemo(() => {
    const map = new Map<string, any>();
    for (const p of prices as any[]) if (!map.has(p.karat)) map.set(p.karat, p);
    return map;
  }, [prices]);

  useEffect(() => {
    document.title = "تسعير الذهب اليومي | مخرّم";
  }, []);

  const save = async (karat: string) => {
    const row = form[karat];
    if (!row?.price) return toast.error("اكتب سعر الجرام");
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase.from("gold_prices").insert({
      karat,
      price_per_gram: Number(row.price),
      making_charge: Number(row.making || 0),
      effective_date: today,
      updated_by: user?.id ?? null,
    });
    if (error) return toast.error(error.message);
    toast.success(`تم تحديث سعر ${karat}`);
    setForm((f) => ({ ...f, [karat]: { price: "", making: "" } }));
    qc.invalidateQueries({ queryKey: ["gold-prices"] });
  };

  if (rolesLoading) return null;
  if (!canEdit) return <Navigate to="/" replace />;

  const calcRow = latest.get(calcKarat);
  // العيارات الموجودة فعلاً على بضاعة نشطة — لا قائمة ثابتة: ما يهمّ هو ما في الدرج.
  const { data: stockKarats } = useQuery({
    queryKey: ["stock-karats"],
    queryFn: async () => {
      const { data } = await supabase
        .from("products")
        .select("karat")
        .neq("status", "archived")
        .not("karat", "is", null);
      const counts = new Map<string, number>();
      for (const r of (data ?? []) as any[]) counts.set(r.karat, (counts.get(r.karat) ?? 0) + 1);
      return counts;
    },
  });

  const unpricedKarats = Array.from(stockKarats?.entries() ?? [])
    .filter(([k]) => !latest.get(k))
    .map(([karat, pieces]) => ({ karat, pieces }));

  const { enabled: pricesShown, setEnabled: setPricesShown, saving: savingSetting } = useShowPricesSetting();

  const suggestion = suggestedPrice(Number(weight) || null, calcRow?.price_per_gram ?? null, calcRow?.making_charge ?? null);

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <header className="flex items-center gap-3">
        <div className="size-10 rounded-xl bg-gold-gradient flex items-center justify-center shadow-gold">
          <Coins className="size-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-xl font-extrabold text-gold-gradient">تسعير الذهب اليومي</h1>
          <p className="text-xs text-muted-foreground">حدّث سعر الجرام والمصنعية لكل عيار — يستخدمها الموظفون لحساب السعر المقترح.</p>
        </div>
      </header>

      {/* مفتاح المالك: الزبون يقف بجانب الموظف وقد يرى شاشته، فليس دائماً مرغوباً أن
          يظهر سعر كل قطعة في الكتالوق. حين يُطفأ يبقى سعر الغرام وحده ظاهراً للموظف في
          صفحته الرئيسية ويبقى تسجيل السعر لزبون متاحاً. المالك يرى الأسعار دائماً. */}
      <Card className="p-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold flex items-center gap-2">
            {pricesShown ? <Eye className="size-4 text-primary" /> : <EyeOff className="size-4 text-muted-foreground" />}
            إظهار أسعار القطع للموظفين
          </p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            {pricesShown
              ? "سعر كل قطعة ظاهر للموظفين في الكتالوق وصفحة القطعة."
              : "الأسعار مخفيّة عن الموظفين — يرون سعر الغرام في صفحتهم الرئيسية ويسجّلون السعر يدوياً. أنت ترى الأسعار دائماً."}
          </p>
        </div>
        <Switch
          checked={pricesShown}
          disabled={savingSetting}
          onCheckedChange={(v) => {
            void setPricesShown(v)
              .then(() => toast.success(v ? "الأسعار ظاهرة للموظفين" : "الأسعار مخفيّة عن الموظفين"))
              .catch((e: any) => toast.error(e.message ?? "تعذّر حفظ الإعداد"));
          }}
          aria-label="إظهار أسعار القطع للموظفين"
        />
      </Card>

      {/* عيار عليه بضاعة ولا سعر غرام له = قطع لا يمكن تسعيرها إطلاقاً، ولا شيء كان
          يُنبّه إلى ذلك: سُجّل سعر ٢٢K بينما بضاعة المتجر ١٨K و٢١K. */}
      {unpricedKarats.length > 0 && (
        <Card className="p-3 border-warning/40 bg-warning/10">
          <p className="text-sm font-semibold flex items-center gap-2">
            <AlertTriangle className="size-4 text-warning-foreground shrink-0" />
            عيارات عليها بضاعة بلا سعر غرام
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {unpricedKarats.map((u) => `${u.karat} (${u.pieces} قطعة)`).join(" · ")} — لن يظهر لها سعر
            للموظفين حتى تُدخل سعر غرامها هنا.
          </p>
        </Card>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        {KARATS.map((k) => {
          const cur = latest.get(k);
          return (
            <Card key={k}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>{k}</span>
                  <span className="text-sm font-normal text-muted-foreground">
                    {cur ? `${formatCurrency(cur.price_per_gram)} / غ` : "لا سعر بعد"}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">سعر الجرام</Label>
                    <Input inputMode="decimal" value={form[k]?.price ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, [k]: { price: e.target.value, making: f[k]?.making ?? "" } }))} />
                  </div>
                  <div>
                    <Label className="text-xs">المصنعية / غ</Label>
                    <Input inputMode="decimal" value={form[k]?.making ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, [k]: { price: f[k]?.price ?? "", making: e.target.value } }))} />
                  </div>
                </div>
                <Button size="sm" className="w-full" onClick={() => save(k)}>
                  <Save className="size-4 ml-1" /> حفظ سعر اليوم
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">حاسبة السعر المقترح</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">الوزن (غ)</Label>
              <Input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">العيار</Label>
              <div className="flex gap-1 mt-1">
                {KARATS.map((k) => (
                  <Button key={k} type="button" size="sm" variant={calcKarat === k ? "default" : "secondary"} onClick={() => setCalcKarat(k)}>
                    {k}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <p className="text-sm">
            السعر المقترح:{" "}
            <span className="text-xl font-extrabold text-primary">
              {suggestion != null ? formatCurrency(suggestion) : "—"}
            </span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">سجل التسعير</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>العيار</TableHead>
                <TableHead className="text-center">سعر الجرام</TableHead>
                <TableHead className="text-center">المصنعية</TableHead>
                <TableHead className="text-center">التاريخ</TableHead>
                <TableHead>بواسطة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(prices as any[]).map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-semibold">{p.karat}</TableCell>
                  <TableCell className="text-center font-mono">{formatCurrency(p.price_per_gram)}</TableCell>
                  <TableCell className="text-center font-mono">{formatCurrency(p.making_charge)}</TableCell>
                  <TableCell className="text-center">{formatDate(p.created_at)}</TableCell>
                  <TableCell>{p.staff?.full_name ?? "—"}</TableCell>
                </TableRow>
              ))}
              {prices.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">لا يوجد سجل بعد</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
