import { useState } from "react";
import Papa from "papaparse";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Upload, Download, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

const REQUIRED = ["name"];
const TEMPLATE_HEADERS = ["name","sku","category","item_type","karat","weight_grams","ring_size","branch","cost_price","sale_price","description"];

export default function ImportProducts() {
  const { user } = useAuth();
  const [parsing, setParsing] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ ok: number; failed: number } | null>(null);

  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => (await supabase.from("branches").select("id,name")).data ?? [],
  });
  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await supabase.from("categories").select("id,name")).data ?? [],
  });

  const downloadTemplate = () => {
    const csv = TEMPLATE_HEADERS.join(",") + "\n" +
      "خاتم ذهب كلاسيك,GR-001,خواتم,خاتم,21K,5.250,16,الفرع الرئيسي,1500,1900,خاتم بسيط أنيق\n";
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "products-template.csv"; a.click();
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true); setErrors([]); setResult(null);
    Papa.parse(file, {
      header: true, skipEmptyLines: true, transformHeader: (h) => h.trim(),
      complete: (res) => {
        const errs: string[] = [];
        const data = res.data as any[];
        data.forEach((r, i) => {
          REQUIRED.forEach((f) => { if (!r[f]?.toString().trim()) errs.push(`السطر ${i + 2}: حقل "${f}" مفقود`); });
        });
        setRows(data); setErrors(errs.slice(0, 10)); setParsing(false);
      },
      error: () => { toast.error("فشل قراءة الملف"); setParsing(false); },
    });
  };

  const doImport = async () => {
    if (!branches || !categories) return;
    setImporting(true); let ok = 0, failed = 0;
    const branchMap = new Map(branches.map((b) => [b.name, b.id]));
    const categoryMap = new Map(categories.map((c) => [c.name, c.id]));

    for (const r of rows) {
      try {
        const payload: any = {
          name: r.name?.toString().trim(),
          sku: r.sku?.toString().trim() || null,
          category_id: categoryMap.get(r.category?.toString().trim()) ?? null,
          branch_id: branchMap.get(r.branch?.toString().trim()) ?? null,
          item_type: r.item_type?.toString().trim() || null,
          karat: r.karat?.toString().trim() || null,
          weight_grams: r.weight_grams ? parseFloat(r.weight_grams) : null,
          ring_size: r.ring_size?.toString().trim() || null,
          cost_price: r.cost_price ? parseFloat(r.cost_price) : null,
          sale_price: r.sale_price ? parseFloat(r.sale_price) : null,
          description: r.description?.toString().trim() || null,
          created_by: user?.id ?? null,
          status: "available" as const,
        };
        if (!payload.name) { failed++; continue; }
        const { error } = await supabase.from("products").insert(payload);
        if (error) failed++; else ok++;
      } catch { failed++; }
    }
    setImporting(false); setResult({ ok, failed });
    toast.success(`تم استيراد ${ok} قطعة` + (failed ? ` (${failed} فشلت)` : ""));
    setRows([]);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold">استيراد منتجات من CSV</h1>
        <p className="text-sm text-muted-foreground">حمّل القالب، املأه، ثم ارفعه. أسماء الفروع والفئات يجب أن تطابق الموجود.</p>
      </div>

      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={downloadTemplate}><Download className="size-4 ml-1" /> تنزيل القالب</Button>
        </div>
        <p className="text-xs text-muted-foreground">الأعمدة: {TEMPLATE_HEADERS.join("، ")}</p>
      </Card>

      <Card className="p-5">
        <label className="block">
          <input type="file" accept=".csv" onChange={onFile} className="hidden" />
          <div className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:bg-muted/50 transition">
            <Upload className="size-8 mx-auto mb-2 text-muted-foreground" />
            <p className="font-semibold">{parsing ? "جارٍ القراءة..." : "اضغط لاختيار ملف CSV"}</p>
          </div>
        </label>
      </Card>

      {errors.length > 0 && (
        <Card className="p-4 bg-destructive/10 border-destructive/30">
          <div className="flex items-center gap-2 mb-2"><AlertCircle className="size-4 text-destructive" /><h3 className="font-semibold text-destructive">أخطاء</h3></div>
          <ul className="text-sm space-y-0.5">{errors.map((e, i) => <li key={i}>• {e}</li>)}</ul>
        </Card>
      )}

      {rows.length > 0 && errors.length === 0 && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2"><CheckCircle2 className="size-5 text-success" /><p className="font-semibold">جاهز للاستيراد: {rows.length} سطر</p></div>
          <div className="max-h-64 overflow-auto border border-border rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-muted sticky top-0"><tr>{Object.keys(rows[0]).slice(0, 6).map((h) => <th key={h} className="p-2 text-right">{h}</th>)}</tr></thead>
              <tbody>{rows.slice(0, 10).map((r, i) => (
                <tr key={i} className="border-t border-border">{Object.keys(rows[0]).slice(0, 6).map((h) => <td key={h} className="p-2">{r[h]}</td>)}</tr>
              ))}</tbody>
            </table>
          </div>
          <Button onClick={doImport} disabled={importing} className="w-full bg-gold-gradient text-primary-foreground">
            {importing ? "جارٍ الاستيراد..." : `استيراد ${rows.length} قطعة`}
          </Button>
        </Card>
      )}

      {result && (
        <Card className="p-5 bg-success/10 border-success/30">
          <p className="font-semibold text-success">اكتمل الاستيراد: {result.ok} نجح · {result.failed} فشل</p>
        </Card>
      )}
    </div>
  );
}
