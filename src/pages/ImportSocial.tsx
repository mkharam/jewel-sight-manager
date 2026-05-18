import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Download, Save, Sparkles, X, FolderUp } from "lucide-react";
import { toast } from "sonner";

type Item = {
  imageUrl: string;
  status: "pending" | "analyzing" | "ready" | "error";
  include: boolean;
  storagePath?: string;
  name: string;
  category: string;
  karat: string;
  description: string;
  error?: string;
  fileBase64?: string;
  fileType?: string;
};

const AI_CREDITS_EXHAUSTED = "AI_CREDITS_EXHAUSTED";
const AI_RATE_LIMITED = "AI_RATE_LIMITED";

const KARATS = ["18K", "21K", "22K", "24K", "ألماس", "فضة"];

export default function ImportSocial() {
  const { user, profile } = useAuth();
  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [saving, setSaving] = useState(false);
  const [sourceTitle, setSourceTitle] = useState<string | null>(null);

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await supabase.from("categories").select("id,name").eq("is_active", true).order("sort_order")).data ?? [],
  });
  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => (await supabase.from("branches").select("id,name").eq("is_active", true)).data ?? [],
  });

  const findCategoryId = (name: string) =>
    categories?.find((c) => c.name === name || name?.includes(c.name))?.id ?? null;

  const fetchImages = async () => {
    if (!url.trim()) return toast.error("الصق رابطاً أولاً");
    setFetching(true);
    setItems([]);
    setSourceTitle(null);
    try {
      // جلب كل الروابط المستوردة سابقاً للتخطّي
      const excludeUrls: string[] = [];
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("product_images")
          .select("source_url")
          .not("source_url", "is", null)
          .range(from, from + pageSize - 1);
        if (error) break;
        const rows = data ?? [];
        for (const r of rows) if (r.source_url) excludeUrls.push(r.source_url);
        if (rows.length < pageSize) break;
      }

      const { data, error } = await supabase.functions.invoke("social-fetch-images", {
        body: { url: url.trim(), excludeUrls },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const imgs: string[] = data?.images ?? [];
      const skipped = data?.skipped ?? 0;
      if (!imgs.length) {
        toast.error(
          skipped
            ? `كل الصور (${skipped}) تم استيرادها مسبقاً`
            : (data?.warning ?? "لم نجد أي صور مناسبة في هذا الرابط")
        );
        return;
      }
      setSourceTitle(data?.sourceTitle ?? null);
      const newItems: Item[] = imgs.map((u) => ({
        imageUrl: u, status: "pending", include: true,
        name: "", category: "", karat: "", description: "",
      }));
      setItems(newItems);
      toast.success(
        `${imgs.length} صورة جديدة` + (skipped ? ` (تم تخطّي ${skipped} مستوردة سابقاً)` : "") + "، جارٍ التحليل..."
      );
      analyzeAll(newItems);
    } catch (e: any) {
      toast.error(e?.message ?? "فشل سحب الصور");
    } finally {
      setFetching(false);
    }
  };

  const analyzeAll = async (list: Item[]) => {
    let idx = 0;
    let stopReason: string | null = null;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    while (idx < list.length && !stopReason) {
      const i = idx++;
      setItems((prev) => prev.map((it, j) => j === i ? { ...it, status: "analyzing" } : it));
      let attempts = 0;
      const maxAttempts = 5;
      while (attempts < maxAttempts && !stopReason) {
        attempts++;
        try {
          const it = list[i];
          const body: Record<string, unknown> = { categories: categories ?? [] };
          if (it.fileBase64) {
            body.imageBase64 = it.fileBase64;
            body.contentType = it.fileType || "image/jpeg";
          } else {
            body.imageUrl = it.imageUrl;
          }
          const { data, error } = await supabase.functions.invoke("social-analyze-image", { body });
          if (error) throw error;
          if (data?.aiBlocked && data?.code === AI_RATE_LIMITED) {
            // wait and retry this same image
            if (attempts < maxAttempts) {
              await sleep(15000);
              continue;
            }
            stopReason = "تم تجاوز حد Gemini مراراً. حاول لاحقاً.";
            throw new Error(stopReason);
          }
          if (data?.aiBlocked) {
            stopReason = data.code === AI_CREDITS_EXHAUSTED
              ? "نفد رصيد AI. تم إيقاف التحليل."
              : "مفتاح AI غير صالح. تم إيقاف التحليل.";
            throw new Error(stopReason);
          }
          if (data?.skipped) throw new Error(data.error ?? "تم تخطي الصورة");
          if (data?.error && !data?.storagePath) throw new Error(data.error);
          setItems((prev) => prev.map((it, j) => j === i ? {
            ...it,
            status: "ready",
            storagePath: data.storagePath,
            name: data.name || "",
            category: data.category || "",
            karat: data.karat || "",
            description: data.description || "",
          } : it));
          break;
        } catch (e: any) {
          if (attempts >= maxAttempts || stopReason) {
            setItems((prev) => prev.map((it, j) => j === i ? {
              ...it, status: "error", include: false, error: e?.message ?? "خطأ",
            } : it));
            break;
          }
        }
      }
      // small spacing between images to respect 5 req/min
      if (idx < list.length && !stopReason) await sleep(13000);
    }
    if (stopReason) {
      setItems((prev) => prev.map((it) => it.status === "pending" ? {
        ...it,
        status: "error",
        include: false,
        error: stopReason ?? "تم إيقاف التحليل",
      } : it));
      toast.error(stopReason);
    }
  };
    if (stopReason) {
      setItems((prev) => prev.map((it) => it.status === "pending" ? {
        ...it,
        status: "error",
        include: false,
        error: stopReason ?? "تم إيقاف التحليل",
      } : it));
      toast.error(stopReason);
    }
  };

  const updateItem = (i: number, patch: Partial<Item>) => {
    setItems((prev) => prev.map((it, j) => j === i ? { ...it, ...patch } : it));
  };

  const removeItem = (i: number) => setItems((prev) => prev.filter((_, j) => j !== i));

  const saveAll = async () => {
    const ready = items.filter((it) => it.include && it.status === "ready" && it.storagePath);
    if (!ready.length) return toast.error("لا توجد منتجات جاهزة للحفظ");
    if (!user) return toast.error("سجّل الدخول أولاً");

    setSaving(true);
    let ok = 0, failed = 0;
    const branchId = profile?.branch_id ?? branches?.[0]?.id ?? null;

    for (const it of ready) {
      try {
        const { data: prod, error: e1 } = await supabase.from("products").insert({
          name: it.name.trim() || "قطعة جديدة",
          category_id: findCategoryId(it.category),
          karat: it.karat || null,
          description: it.description || null,
          branch_id: branchId,
          status: "available",
          created_by: user.id,
        }).select("id").single();
        if (e1 || !prod) { failed++; continue; }
        const { error: e2 } = await supabase.from("product_images").insert({
          product_id: prod.id,
          storage_path: it.storagePath!,
          is_primary: true,
          uploaded_by: user.id,
          source_url: it.imageUrl,
        });
        if (e2) { failed++; continue; }
        ok++;
      } catch { failed++; }
    }
    setSaving(false);
    toast.success(`تم حفظ ${ok} منتج` + (failed ? ` (${failed} فشل)` : ""));
    if (ok) setItems([]);
  };

  const handleBulkFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!arr.length) return toast.error("اختر صوراً (JPG/PNG/WEBP)");
    setItems([]);
    setSourceTitle(`📁 ${arr.length} صورة من المجلد`);
    const newItems: Item[] = await Promise.all(
      arr.map(
        (f) =>
          new Promise<Item>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl = String(reader.result || "");
              const base64 = dataUrl.split(",")[1] ?? "";
              resolve({
                imageUrl: dataUrl,
                fileBase64: base64,
                fileType: f.type,
                status: "pending",
                include: true,
                name: "",
                category: "",
                karat: "",
                description: "",
              });
            };
            reader.readAsDataURL(f);
          })
      )
    );
    setItems(newItems);
    toast.success(`تم تحميل ${newItems.length} صورة، جارٍ التحليل...`);
    analyzeAll(newItems);
  };

  const readyCount = items.filter((it) => it.include && it.status === "ready").length;

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="size-6 text-primary" />
          استيراد من فيسبوك / انستجرام
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          الصق رابط منشور أو ألبوم. النظام يسحب الصور ويحللها بالذكاء الاصطناعي ويقترح اسم وفئة وعيار لكل قطعة.
        </p>
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.facebook.com/... أو https://www.instagram.com/p/..."
            dir="ltr"
            className="flex-1"
          />
          <Button onClick={fetchImages} disabled={fetching} className="bg-gold-gradient text-primary-foreground">
            {fetching ? <Loader2 className="size-4 animate-spin ml-1" /> : <Download className="size-4 ml-1" />}
            {fetching ? "جارٍ السحب..." : "سحب الصور"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          ⚠️ الحسابات الخاصة لا تعمل. للحصول على نتائج أفضل: استخدم رابط منشور عام أو ألبوم صور عام.
        </p>

        <div className="border-t border-border pt-3">
          <label className="flex flex-col sm:flex-row sm:items-center gap-2 cursor-pointer">
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleBulkFiles(e.target.files)}
            />
            <span className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-secondary px-4 py-2 text-sm font-medium hover:bg-secondary/80">
              <FolderUp className="size-4" />
              رفع مجلد صور من الجهاز
            </span>
            <span className="text-xs text-muted-foreground">
              مفيد بعد تنزيل صور بـ gallery-dl. الصور تُحلَّل بالـ AI مثل الرابط تماماً.
            </span>
          </label>
        </div>
      </Card>

      {sourceTitle && (
        <p className="text-sm text-muted-foreground">📄 المصدر: {sourceTitle}</p>
      )}

      {items.length > 0 && (
        <div className="flex items-center justify-between sticky top-14 sm:top-16 z-20 bg-background/95 backdrop-blur py-2 -mx-3 px-3 border-b border-border">
          <p className="font-semibold">
            {readyCount} / {items.length} جاهز
          </p>
          <Button onClick={saveAll} disabled={saving || !readyCount} className="bg-gold-gradient text-primary-foreground">
            {saving ? <Loader2 className="size-4 animate-spin ml-1" /> : <Save className="size-4 ml-1" />}
            حفظ {readyCount} منتج
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map((it, i) => (
          <Card key={i} className="overflow-hidden">
            <div className="flex gap-3 p-3">
              <div className="relative shrink-0">
                <img
                  src={it.imageUrl}
                  alt=""
                  className="size-28 rounded-lg object-cover bg-muted"
                  onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0.3"; }}
                />
                <button
                  onClick={() => removeItem(i)}
                  className="absolute -top-1 -right-1 size-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow"
                  aria-label="إزالة"
                >
                  <X className="size-3" />
                </button>
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                {it.status === "analyzing" && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Loader2 className="size-3 animate-spin" /> جارٍ التحليل...
                  </p>
                )}
                {it.status === "error" && (
                  <p className="text-xs text-destructive">⚠️ {it.error}</p>
                )}
                {it.status === "ready" && (
                  <>
                    <div className="flex items-center gap-2">
                      <Checkbox checked={it.include} onCheckedChange={(v) => updateItem(i, { include: !!v })} id={`inc-${i}`} />
                      <label htmlFor={`inc-${i}`} className="text-xs text-muted-foreground">تضمين في الحفظ</label>
                    </div>
                    <Input
                      value={it.name}
                      onChange={(e) => updateItem(i, { name: e.target.value })}
                      placeholder="اسم القطعة"
                      className="text-sm font-semibold"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Select value={it.category} onValueChange={(v) => updateItem(i, { category: v })}>
                        <SelectTrigger className="text-xs h-9"><SelectValue placeholder="الفئة" /></SelectTrigger>
                        <SelectContent>
                          {categories?.map((c) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Select value={it.karat} onValueChange={(v) => updateItem(i, { karat: v })}>
                        <SelectTrigger className="text-xs h-9"><SelectValue placeholder="العيار" /></SelectTrigger>
                        <SelectContent>
                          {KARATS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <Textarea
                      value={it.description}
                      onChange={(e) => updateItem(i, { description: e.target.value })}
                      placeholder="وصف"
                      rows={2}
                      className="text-xs resize-none"
                    />
                  </>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
