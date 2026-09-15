// تصحيح بيانات قطعة من بضاعة فرع الموظف.
//
// الذكاء الاصطناعي يسمّي القطع تلقائياً بعد التصوير المتتالي، فيمرّ اسم أو عيار خاطئ.
// كان التصحيح مقصوراً على من صوّر القطعة بنفسه، فالموظف يرى الخطأ على قطعة في درجه ولا
// يملك إصلاحه. المعيار الآن بضاعة الفرع. الحقول هنا وصفية فقط؛ الأسعار والفرع والحالة
// والباركود للإدارة، والدالة update_own_product_details لا تلمسها أصلاً.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invalidateInventoryAndSales } from "@/lib/queryInvalidation";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pencil, Loader2 } from "lucide-react";
import { KARAT_OPTIONS, normalizeDecimalInput } from "@/lib/constants";
import { GOLD_COLORS } from "@/lib/luxury";
import { toast } from "sonner";

interface Props {
  product: {
    id: string;
    name: string;
    category_id?: string | null;
    karat: string | null;
    gold_color?: string | null;
    weight_grams: number | null;
    ring_size: string | null;
  };
}

const NONE = "__none__";

export default function EditOwnProductSheet({ product }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState(product.name);
  const [categoryId, setCategoryId] = useState(product.category_id ?? NONE);
  const [karat, setKarat] = useState(product.karat ?? NONE);
  const [goldColor, setGoldColor] = useState(product.gold_color ?? NONE);
  const [weight, setWeight] = useState(product.weight_grams != null ? String(product.weight_grams) : "");
  const [ringSize, setRingSize] = useState(product.ring_size ?? "");

  // إعادة الضبط عند كل فتح: لو أُغلقت اللوحة بلا حفظ لا تبقى التعديلات المهجورة معلّقة.
  useEffect(() => {
    if (!open) return;
    setName(product.name);
    setCategoryId(product.category_id ?? NONE);
    setKarat(product.karat ?? NONE);
    setGoldColor(product.gold_color ?? NONE);
    setWeight(product.weight_grams != null ? String(product.weight_grams) : "");
    setRingSize(product.ring_size ?? "");
  }, [open, product]);

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await supabase.from("categories").select("id,name").order("name")).data ?? [],
    enabled: open,
  });

  const save = async () => {
    if (!name.trim()) return toast.error("اكتب اسم القطعة");
    setSaving(true);
    // تعديل صريح: الدالة لا تلمس إلا الحقول الواردة هنا. اللوحة تعرض الحقول الستة كلها
    // فتمرّرها كلها، وتمرير null يعني «امسح هذا الحقل» لا «اتركه».
    const { error } = await supabase.rpc("update_own_product_details", {
      p_product_id: product.id,
      p_patch: {
        name: name.trim(),
        category_id: categoryId === NONE ? null : categoryId,
        karat: karat === NONE ? null : karat,
        gold_color: goldColor === NONE ? null : goldColor,
        weight_grams: weight.trim() === "" ? null : Number(weight),
        ring_size: ringSize.trim() || null,
      },
    });
    setSaving(false);
    // supabase-js يُرجع الخطأ ولا يرميه — بدون هذا الفحص كانت تظهر رسالة نجاح والتعديل
    // لم يُحفظ أصلاً.
    if (error) return toast.error(error.message);
    toast.success("تم حفظ التعديل");
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["product", product.id] });
    invalidateInventoryAndSales(qc);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" className="w-full h-11">
          <Pencil className="size-4 ml-1" /> تعديل بيانات القطعة
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[92vh] overflow-y-auto">
        <SheetHeader className="text-right">
          <SheetTitle>تعديل بيانات القطعة</SheetTitle>
          <SheetDescription>
            صحّح ما جاء خطأً في التسمية التلقائية — الأسعار والفرع والحالة تخصّ الإدارة.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-3 mt-4">
          <div>
            <Label>اسم القطعة *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} className="h-11" />
          </div>

          <div>
            <Label>الصنف</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="h-11"><SelectValue placeholder="بدون صنف" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>بدون صنف</SelectItem>
                {categories.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>العيار</Label>
              <Select value={karat} onValueChange={setKarat}>
                <SelectTrigger className="h-11"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  {KARAT_OPTIONS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>لون الذهب</Label>
              <Select value={goldColor} onValueChange={setGoldColor}>
                <SelectTrigger className="h-11"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  {GOLD_COLORS.map((g) => (
                    <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>الوزن (غ)</Label>
              {/* type="text" مع التطبيع: لوحة المفاتيح العربية تكتب أرقاماً هندية يرفضها
                  حقل type="number" بصمت. راجع normalizeDecimalInput. */}
              <Input
                type="text"
                inputMode="decimal"
                dir="ltr"
                value={weight}
                onChange={(e) => setWeight(normalizeDecimalInput(e.target.value))}
                className="h-11"
              />
            </div>
            <div>
              <Label>المقاس</Label>
              <Input value={ringSize} onChange={(e) => setRingSize(e.target.value)} maxLength={20} className="h-11" />
            </div>
          </div>

          <Button onClick={save} disabled={saving} className="w-full h-12 bg-gold-gradient text-primary-foreground" size="lg">
            {saving ? <Loader2 className="size-4 animate-spin ml-1" /> : null}
            {saving ? "جارٍ الحفظ..." : "حفظ التعديل"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
