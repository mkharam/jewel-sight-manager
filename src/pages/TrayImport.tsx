// إدخال سريع بالصينية: صورة واحدة فيها عدة قطع → الذكاء الاصطناعي يفصلها
// ويقترح لكل قطعة اسم/فئة/عيار/وصف، ثم تُحفظ بفرع محدد مع SKU تلقائي.
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Camera, FolderUp, Layers, Loader2, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { KARAT_OPTIONS } from "@/lib/constants";
import { compressImage } from "@/lib/image-compress";

type Piece = {
  key: string;
  include: boolean;
  position: string;
  name: string;
  category: string;
  karat: string;
  item_type: string;
  description: string;
  analysis: any;
};

export default function TrayImport() {
  const { user, profile } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [branchId, setBranchId] = useState<string>(profile?.branch_id ?? "");
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: async () =>
      (await supabase.from("categories").select("id,name").eq("is_active", true).order("sort_order")).data ?? [],
  });
  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => (await supabase.from("branches").select("id,name").eq("is_active", true)).data ?? [],
  });

  const findCategoryId = (name: string) =>
    categories?.find((c) => c.name === name || (name && name.includes(c.name)))?.id ?? null;

  const pick = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) return toast.error("اختر صورة");
    const small = await compressImage(f, { maxDimension: 1800, quality: 0.85 });
    setFile(small);
    setPreviewUrl(URL.createObjectURL(small));
    setPieces([]);
    setProvider(null);
    void analyze(small);
  };

  const analyze = async (f: File) => {
    setAnalyzing(true);
    try {
      const base64 = await fileToBase64(f);
      const { data, error } = await supabase.functions.invoke("analyze-tray", {
        body: { imageBase64: base64, mimeType: f.type, categories: categories ?? [] },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const list: any[] = (data as any)?.pieces ?? [];
      setProvider((data as any)?.provider ?? null);
      setPieces(
        list.map((p, i) => ({
          key: `${Date.now()}-${i}`,
          include: true,
          position: p.position || `قطعة ${i + 1}`,
          name: p.name_ar || "",
          category: p.category_name || "",
          karat: KARAT_OPTIONS.includes(p.karat) ? p.karat : "",
          item_type: p.category_name || "",
          description: p.description_ar || "",
          analysis: p,
        })),
      );
      toast.success(`تم التعرّف على ${list.length} قطعة في الصورة`);
    } catch (e: any) {
      toast.error(e?.message ?? "فشل التحليل — أعد المحاولة");
    } finally {
      setAnalyzing(false);
    }
  };

  const update = (key: string, p: Partial<Piece>) =>
    setPieces((prev) => prev.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const saveAll = async () => {
    if (!user) return toast.error("سجّل الدخول أولاً");
    if (!branchId) return toast.error("اختر الفرع أولاً");
    const chosen = pieces.filter((p) => p.include);
    if (!chosen.length) return toast.error("لا توجد قطع محددة");

    setSaving(true);
    let ok = 0;
    let failed = 0;
    let storagePath: string | null = null;
    try {
      if (file) {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
        const path = `trays/${user.id}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("product-images").upload(path, file);
        if (!upErr) storagePath = path;
      }

      for (const p of chosen) {
        try {
          let sku: string | null = null;
          try {
            const { data } = await supabase.rpc("next_sku", {
              _branch_id: branchId,
              _item_type: p.item_type || p.category || null,
            });
            sku = (data as unknown as string) ?? null;
          } catch { /* SKU اختياري */ }

          const { data: prod, error } = await supabase
            .from("products")
            .insert({
              name: p.name.trim() || "قطعة جديدة",
              sku,
              category_id: findCategoryId(p.category),
              karat: p.karat || null,
              item_type: p.item_type || null,
              description: p.description || null,
              branch_id: branchId,
              status: "available",
              created_by: user.id,
            })
            .select("id")
            .single();
          if (error || !prod) throw error ?? new Error("insert failed");

          if (storagePath) {
            const { data: img } = await supabase
              .from("product_images")
              .insert({
                product_id: prod.id,
                storage_path: storagePath,
                is_primary: true,
                uploaded_by: user.id,
              })
              .select("id")
              .single();
            if (img) {
              // فهرسة الوسوم + بصمة البحث بالصورة (بدون إعادة تحليل)
              void supabase.functions.invoke("analyze-product-image", {
                body: { imageId: img.id, analysis: p.analysis, categories: categories ?? [] },
              });
            }
          }
          ok++;
        } catch {
          failed++;
        }
      }
    } finally {
      setSaving(false);
    }

    toast.success(`تم حفظ ${ok} قطعة` + (failed ? ` (${failed} فشل)` : ""));
    if (ok) {
      setPieces([]);
      setFile(null);
      setPreviewUrl(null);
    }
  };

  const readyCount = pieces.filter((p) => p.include).length;

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Layers className="size-6 text-primary" />
          إدخال بالصينية
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          صوّر عدة قطع في صورة واحدة (صينية أو علبة عرض) والنظام يفصلها ويقترح لكل قطعة اسم وفئة وعيار ووصف — ثم
          تُحفظ بفرعك مع رقم SKU تلقائي. أسرع بكثير من تصوير كل قطعة بروحها.
        </p>
      </div>

      <Card className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files)} />
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => pick(e.target.files)}
          />
          <Button variant="outline" className="h-12" onClick={() => cameraRef.current?.click()}>
            <Camera className="size-4 ml-2" /> تصوير الآن
          </Button>
          <Button variant="outline" className="h-12" onClick={() => galleryRef.current?.click()}>
            <FolderUp className="size-4 ml-2" /> من المعرض
          </Button>
        </div>

        <div>
          <label className="text-xs text-muted-foreground">الفرع</label>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="h-11">
              <SelectValue placeholder="اختر الفرع" />
            </SelectTrigger>
            <SelectContent>
              {(branches ?? []).map((b: any) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {previewUrl && (
          <div className="flex items-center gap-3">
            <img src={previewUrl} alt="صينية القطع" className="size-24 rounded-lg object-cover bg-muted" />
            {analyzing ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" /> جارٍ فصل القطع وتحليلها…
              </p>
            ) : (
              provider && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Sparkles className="size-3 text-primary" /> تحليل بواسطة {provider}
                </p>
              )
            )}
          </div>
        )}
      </Card>

      {pieces.length > 0 && (
        <div className="flex items-center justify-between sticky top-14 sm:top-16 z-20 bg-background/95 backdrop-blur py-2 -mx-3 px-3 border-b border-border">
          <p className="text-sm font-semibold">{readyCount} / {pieces.length} محددة</p>
          <Button onClick={saveAll} disabled={saving || !readyCount} className="bg-gold-gradient text-primary-foreground">
            {saving ? <Loader2 className="size-4 animate-spin ml-1" /> : <Save className="size-4 ml-1" />}
            حفظ {readyCount} قطعة
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {pieces.map((p) => (
          <Card key={p.key} className="p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Checkbox id={`inc-${p.key}`} checked={p.include} onCheckedChange={(v) => update(p.key, { include: !!v })} />
                <label htmlFor={`inc-${p.key}`} className="text-xs text-muted-foreground">تضمين</label>
              </div>
              <span className="text-[11px] rounded-full bg-secondary px-2 py-0.5 text-muted-foreground">{p.position}</span>
            </div>
            <Input value={p.name} onChange={(e) => update(p.key, { name: e.target.value })} placeholder="اسم القطعة" />
            <div className="grid grid-cols-2 gap-2">
              <Input value={p.item_type} onChange={(e) => update(p.key, { item_type: e.target.value })} placeholder="النوع" />
              <Select value={p.karat} onValueChange={(v) => update(p.key, { karat: v })}>
                <SelectTrigger><SelectValue placeholder="العيار" /></SelectTrigger>
                <SelectContent>
                  {KARAT_OPTIONS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Textarea
              value={p.description}
              onChange={(e) => update(p.key, { description: e.target.value })}
              rows={2}
              placeholder="الوصف"
            />
          </Card>
        ))}
      </div>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
