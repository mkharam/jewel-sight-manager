import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, Upload, X, Star, Sparkles, Loader2 } from "lucide-react";
import { PRODUCT_STATUS, KARAT_OPTIONS, getImageUrl } from "@/lib/constants";
import { toast } from "sonner";

type AiSuggestion = {
  name_ar?: string;
  category_id?: string | null;
  category_name?: string | null;
  item_type?: string | null;
  karat?: string | null;
  style?: string[];
  gemstones?: string[];
  stone_count?: string | null;
  condition?: string | null;
  description_ar?: string;
};

const schema = z.object({
  name: z.string().trim().min(2, "الاسم قصير").max(150),
  sku: z.string().trim().max(80).optional(),
  category_id: z.string().uuid().nullable(),
  branch_id: z.string().uuid().nullable(),
  karat: z.string().max(20).nullable(),
  item_type: z.string().max(50).nullable(),
  weight_grams: z.number().nonnegative().nullable(),
  ring_size: z.string().max(20).nullable(),
  status: z.enum(["available","reserved","sold","in_transfer","damaged","lost","in_repair","stock_discrepancy","archived"]),
  cost_price: z.number().nonnegative().nullable(),
  sale_price: z.number().nonnegative().nullable(),
  promo_price: z.number().nonnegative().nullable(),
  description: z.string().max(2000).nullable(),
  internal_notes: z.string().max(2000).nullable(),
  serial_number: z.string().max(80).nullable(),
  barcode_value: z.string().max(80).nullable(),
  showcase_location: z.string().max(80).nullable(),
});

export default function ProductForm() {
  const { id } = useParams<{ id: string }>();
  const editing = id && id !== "new";
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const [form, setForm] = useState({
    name: "", sku: "", category_id: "", branch_id: "",
    karat: "", item_type: "", weight_grams: "", ring_size: "",
    status: "available" as keyof typeof PRODUCT_STATUS,
    cost_price: "", sale_price: "", promo_price: "",
    description: "", internal_notes: "",
    serial_number: "", barcode_value: "", showcase_location: "",
  });
  const [existingImages, setExistingImages] = useState<{ id: string; storage_path: string; is_primary: boolean }[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [primaryIndex, setPrimaryIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<AiSuggestion | null>(null);
  const [aiApplied, setAiApplied] = useState<Set<string>>(new Set());

  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: async () =>
      (await supabase.from("branches").select("id,name,code").order("name")).data ?? [],
  });
  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: async () =>
      (await supabase.from("categories").select("id,name,name_en").order("sort_order")).data ?? [],
  });

  useEffect(() => {
    if (!editing) {
      if (profile?.branch_id) setForm((f) => ({ ...f, branch_id: profile.branch_id! }));
      return;
    }
    (async () => {
      const { data } = await supabase.from("products").select("*, images:product_images(id,storage_path,is_primary,sort_order)").eq("id", id!).maybeSingle();
      if (!data) return;
      setForm({
        name: data.name ?? "", sku: data.sku ?? "",
        category_id: data.category_id ?? "", branch_id: data.branch_id ?? "",
        karat: data.karat ?? "", item_type: data.item_type ?? "",
        weight_grams: data.weight_grams?.toString() ?? "",
        ring_size: data.ring_size ?? "", status: data.status,
        cost_price: data.cost_price?.toString() ?? "",
        sale_price: data.sale_price?.toString() ?? "",
        promo_price: data.promo_price?.toString() ?? "",
        description: data.description ?? "", internal_notes: data.internal_notes ?? "",
        serial_number: data.serial_number ?? "", barcode_value: data.barcode_value ?? "", showcase_location: data.showcase_location ?? "",
      });
      setExistingImages(data.images ?? []);
    })();
  }, [editing, id, profile?.branch_id]);

  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const valid = files.filter((f) => f.size <= 5 * 1024 * 1024 && f.type.startsWith("image/"));
    if (valid.length < files.length) toast.error("بعض الملفات تجاوزت 5MB أو ليست صور");
    if (valid.length === 0) return;

    const wasEmpty = newFiles.length === 0 && existingImages.length === 0;
    setNewFiles((p) => [...p, ...valid].slice(0, 8));

    // Auto-analyze the first newly-added photo when the product has no photos yet.
    if (wasEmpty && !editing) {
      void analyzeWithAi(valid[0]);
    }
  };

  const analyzeWithAi = async (file: File) => {
    setAiLoading(true);
    try {
      const base64: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve((r.result as string).split(",")[1]);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const { data, error } = await supabase.functions.invoke("analyze-product-image", {
        body: {
          imageBase64: base64,
          mimeType: file.type,
          categories: categories ?? [],
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      const s = data as AiSuggestion;
      setAiSuggestion(s);

      // Pre-fill only empty fields so we never overwrite the employee's input.
      const applied = new Set<string>();
      setForm((f) => {
        const next = { ...f };
        if (!f.name && s.name_ar) { next.name = s.name_ar; applied.add("name"); }
        if (!f.category_id && s.category_id) { next.category_id = s.category_id; applied.add("category_id"); }
        if (!f.item_type && s.item_type) { next.item_type = s.item_type; applied.add("item_type"); }
        if (!f.karat && s.karat && KARAT_OPTIONS.includes(s.karat)) {
          next.karat = s.karat; applied.add("karat");
        }
        if (!f.description && s.description_ar) {
          const extras = [s.stone_count, s.condition].filter(Boolean).join(" — ");
          next.description = extras ? `${s.description_ar}\n(${extras})` : s.description_ar;
          applied.add("description");
        }
        return next;
      });
      setAiApplied(applied);
      toast.success("تم التحليل بالذكاء ✨", { description: "راجع الحقول قبل الحفظ" });
    } catch (err: any) {
      toast.error("تعذّر التحليل", { description: err.message ?? "املأ الحقول يدوياً" });
    } finally {
      setAiLoading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({
      name: form.name, sku: form.sku || undefined,
      category_id: form.category_id || null, branch_id: form.branch_id || null,
      karat: form.karat || null, item_type: form.item_type || null,
      weight_grams: form.weight_grams ? parseFloat(form.weight_grams) : null,
      ring_size: form.ring_size || null, status: form.status,
      cost_price: form.cost_price ? parseFloat(form.cost_price) : null,
      sale_price: form.sale_price ? parseFloat(form.sale_price) : null,
      promo_price: form.promo_price ? parseFloat(form.promo_price) : null,
      description: form.description || null, internal_notes: form.internal_notes || null,
      serial_number: form.serial_number || null, barcode_value: form.barcode_value || null, showcase_location: form.showcase_location || null,
    });
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);

    setSaving(true);
    try {
      let productId = id;
      const payload = { ...parsed.data };

      // توليد SKU تلقائي مرتّب ومربوط بالفرع (دالة قاعدة بيانات بقفل يمنع التكرار)
      if (!editing && !payload.sku && payload.branch_id) {
        try {
          const { data: sku, error: skuErr } = await supabase.rpc("next_sku", {
            _branch_id: payload.branch_id,
            _item_type: payload.item_type || null,
          });
          if (skuErr) throw skuErr;
          if (sku) payload.sku = sku as unknown as string;
        } catch (e) {
          console.warn("SKU auto-generation skipped", e);
        }
      }


      if (editing) {
        const { error } = await supabase.from("products").update({ ...payload, updated_by: user?.id }).eq("id", id!);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("products")
          // الـ SKU يُولّده مشغّل قاعدة البيانات تلقائياً عند تركه فارغاً
          .insert({ ...payload, name: payload.name, created_by: user?.id ?? null } as any)
          .select("id")
          .single();
        if (error) throw error;
        productId = data.id;
      }

      // Upload new images — path convention: branch-<branchId>/<productId>/<file>
      const branchPrefix = payload.branch_id ? `branch-${payload.branch_id}` : "unassigned";
      const totalImages = existingImages.length + newFiles.length;
      const uploadedImageIds: { id: string; file: File; isPrimary: boolean }[] = [];
      for (let i = 0; i < newFiles.length; i++) {
        const file = newFiles[i];
        const ext = file.name.split(".").pop();
        const path = `${branchPrefix}/${productId}/${Date.now()}-${i}.${ext}`;
        const { error: upErr } = await supabase.storage.from("product-images").upload(path, file);
        if (upErr) throw upErr;
        const isPrimary = totalImages === newFiles.length && i === primaryIndex;
        const { data: imgRow, error: imgErr } = await supabase
          .from("product_images")
          .insert({
            product_id: productId!,
            storage_path: path,
            is_primary: isPrimary,
            sort_order: existingImages.length + i,
            uploaded_by: user?.id,
          })
          .select("id")
          .single();
        if (imgErr) throw imgErr;
        uploadedImageIds.push({ id: imgRow.id, file, isPrimary });
      }

      // Fire-and-forget: analyze + embed each new image so search-by-photo finds it.
      // We don't block the save on this — the toast confirms success independently.
      for (const { id: imageId, file } of uploadedImageIds) {
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(",")[1];
          supabase.functions
            .invoke("analyze-product-image", {
              body: {
                imageBase64: base64,
                mimeType: file.type,
                categories: categories ?? [],
                imageId,
              },
            })
            .catch((e) => console.warn("Background embed failed", e));
        };
        reader.readAsDataURL(file);
      }

      await supabase.from("activity_log").insert({
        actor_id: user?.id,
        action: editing ? "update" : "create",
        entity_type: "product",
        entity_id: productId,
        details: { name: parsed.data.name },
      });

      toast.success(editing ? "تم التحديث" : "تمت الإضافة");
      navigate(`/products/${productId}`);
    } catch (err: any) {
      toast.error(err.message ?? "خطأ في الحفظ");
    } finally {
      setSaving(false);
    }
  };

  const removeExisting = async (imgId: string, path: string) => {
    if (!confirm("حذف هذه الصورة؟")) return;
    await supabase.storage.from("product-images").remove([path]);
    await supabase.from("product_images").delete().eq("id", imgId);
    setExistingImages((arr) => arr.filter((i) => i.id !== imgId));
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
        <ArrowRight className="size-4 ml-1" /> رجوع
      </Button>

      <h1 className="text-2xl font-bold">{editing ? "تعديل قطعة" : "إضافة قطعة جديدة"}</h1>

      {(aiLoading || aiSuggestion) && (
        <div className="rounded-xl bg-gold-soft border border-primary/20 p-3 flex items-start gap-3">
          {aiLoading ? (
            <Loader2 className="size-5 text-primary animate-spin shrink-0 mt-0.5" />
          ) : (
            <Sparkles className="size-5 text-primary shrink-0 mt-0.5" />
          )}
          <div className="flex-1 text-sm">
            {aiLoading ? (
              <p className="font-semibold">جارٍ تحليل الصورة بالذكاء الاصطناعي…</p>
            ) : (
              <>
                <p className="font-semibold">تم اقتراح بعض الحقول تلقائياً</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  الحقول المميّزة بـ ✨ اقترحها الذكاء الاصطناعي — راجعها قبل الحفظ.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        <Card className="p-5 space-y-4">
          <Field label="اسم القطعة *" aiHint={aiApplied.has("name")}>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={150} autoFocus={!editing} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الفئة" aiHint={aiApplied.has("category_id")}>
              <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                <SelectTrigger><SelectValue placeholder="اختر..." /></SelectTrigger>
                <SelectContent>
                  {categories?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="النوع (خاتم، سوار...)" aiHint={aiApplied.has("item_type")}>
              <Input value={form.item_type} onChange={(e) => setForm({ ...form, item_type: e.target.value })} maxLength={50} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="القيراط" aiHint={aiApplied.has("karat")}>
              <Select value={form.karat} onValueChange={(v) => setForm({ ...form, karat: v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {KARAT_OPTIONS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="الوزن (غ)">
              <Input type="number" step="0.001" inputMode="decimal" value={form.weight_grams} onChange={(e) => setForm({ ...form, weight_grams: e.target.value })} dir="ltr" />
            </Field>
            <Field label="المقاس">
              <Input value={form.ring_size} onChange={(e) => setForm({ ...form, ring_size: e.target.value })} maxLength={20} dir="ltr" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الفرع">
              <Select value={form.branch_id} onValueChange={(v) => setForm({ ...form, branch_id: v })}>
                <SelectTrigger><SelectValue placeholder="اختر..." /></SelectTrigger>
                <SelectContent>
                  {branches?.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="الحالة">
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PRODUCT_STATUS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="SKU (يُولّد تلقائياً من رمز الفرع إن تُرك فارغاً)">
            <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} maxLength={80} dir="ltr" placeholder="مثال: JRB-RNG-2607-0001" />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="الرقم التسلسلي"><Input value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} maxLength={80} dir="ltr" /></Field>
            <Field label="باركود/QR"><Input value={form.barcode_value} onChange={(e) => setForm({ ...form, barcode_value: e.target.value })} maxLength={80} dir="ltr" /></Field>
            <Field label="موقع العرض"><Input value={form.showcase_location} onChange={(e) => setForm({ ...form, showcase_location: e.target.value })} maxLength={80} placeholder="مثال: دولاب 3 - رف B" /></Field>
          </div>
        </Card>

        <Card className="p-5 space-y-4">
          <h2 className="font-bold">الأسعار</h2>
          <div className="grid grid-cols-3 gap-3">
            <Field label="التكلفة"><Input type="number" step="0.01" inputMode="decimal" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} dir="ltr" /></Field>
            <Field label="سعر البيع"><Input type="number" step="0.01" inputMode="decimal" value={form.sale_price} onChange={(e) => setForm({ ...form, sale_price: e.target.value })} dir="ltr" /></Field>
            <Field label="سعر العرض"><Input type="number" step="0.01" inputMode="decimal" value={form.promo_price} onChange={(e) => setForm({ ...form, promo_price: e.target.value })} dir="ltr" /></Field>
          </div>
        </Card>

        <Card className="p-5 space-y-4">
          <h2 className="font-bold">الوصف والملاحظات</h2>
          <Field label="الوصف" aiHint={aiApplied.has("description")}><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} maxLength={2000} /></Field>
          <Field label="ملاحظات داخلية (للموظفين فقط)"><Textarea value={form.internal_notes} onChange={(e) => setForm({ ...form, internal_notes: e.target.value })} rows={2} maxLength={2000} /></Field>
        </Card>

        <Card className="p-5 space-y-4">
          <h2 className="font-bold">الصور</h2>
          {existingImages.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {existingImages.map((img) => (
                <div key={img.id} className="relative aspect-square rounded overflow-hidden bg-muted">
                  <img src={getImageUrl(img.storage_path)!} className="w-full h-full object-cover" alt="" />
                  {img.is_primary && <Star className="absolute top-1 right-1 size-4 fill-primary text-primary" />}
                  <button type="button" onClick={() => removeExisting(img.id, img.storage_path)} className="absolute top-1 left-1 size-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center">
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {newFiles.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {newFiles.map((f, i) => (
                <div key={i} className={`relative aspect-square rounded overflow-hidden bg-muted ring-2 ${i === primaryIndex ? "ring-primary" : "ring-transparent"}`}>
                  <img src={URL.createObjectURL(f)} className="w-full h-full object-cover" alt="" />
                  <button type="button" onClick={() => setPrimaryIndex(i)} className="absolute top-1 right-1 size-6 rounded-full bg-card flex items-center justify-center" title="جعلها رئيسية">
                    <Star className={`size-3 ${i === primaryIndex ? "fill-primary text-primary" : ""}`} />
                  </button>
                  <button type="button" onClick={() => setNewFiles((arr) => arr.filter((_, j) => j !== i))} className="absolute top-1 left-1 size-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center">
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <label className="block">
            <input type="file" multiple accept="image/*" onChange={onFiles} className="hidden" />
            <div className="border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:bg-muted/50 transition">
              <Upload className="size-6 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm font-medium">اضغط لإضافة صور (حتى 8 صور، 5MB لكل صورة)</p>
            </div>
          </label>
        </Card>

        <div className="flex gap-2 sticky bottom-20 md:bottom-4">
          <Button type="submit" disabled={saving} className="flex-1 bg-gold-gradient text-primary-foreground shadow-gold" size="lg">
            {saving ? "جارٍ الحفظ..." : editing ? "تحديث" : "إضافة القطعة"}
          </Button>
          <Button type="button" variant="outline" size="lg" onClick={() => navigate(-1)}>إلغاء</Button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children, aiHint }: { label: string; children: React.ReactNode; aiHint?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold flex items-center gap-1">
        {label}
        {aiHint && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">
            <Sparkles className="size-2.5" />
            AI
          </span>
        )}
      </Label>
      {children}
    </div>
  );
}
