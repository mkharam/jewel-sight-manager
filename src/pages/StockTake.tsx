import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardCheck, Check, X, Play, Lock, Search } from "lucide-react";
import { formatDate } from "@/lib/constants";
import { normalizeArabic } from "@/lib/arabic-search";
import { toast } from "sonner";

export default function StockTake() {
  const { user, profile, roles } = useAuth();
  const qc = useQueryClient();
  const isAdmin = roles.includes("admin");
  const [branchId, setBranchId] = useState<string>("");
  const [q, setQ] = useState("");

  useEffect(() => { document.title = "الجرد الميداني | مخرّم"; }, []);
  useEffect(() => {
    if (!branchId && profile?.branch_id) setBranchId(profile.branch_id);
  }, [profile?.branch_id, branchId]);

  const { data: branches = [] } = useQuery({
    queryKey: ["branches-active"],
    queryFn: async () => {
      const { data } = await supabase.from("branches").select("id,name").eq("is_active", true).order("name");
      return data ?? [];
    },
  });

  const { data: session } = useQuery({
    queryKey: ["stock-take-open", branchId],
    queryFn: async () => {
      const { data } = await supabase
        .from("stock_take_sessions")
        .select("*")
        .eq("branch_id", branchId)
        .eq("status", "open")
        .order("started_at", { ascending: false })
        .maybeSingle();
      return data;
    },
    enabled: !!branchId,
  });

  const { data: products = [] } = useQuery({
    queryKey: ["stock-take-products", branchId],
    queryFn: async () => {
      const { data } = await supabase
        .from("products")
        .select("id,name,sku,karat,weight_grams,status")
        .eq("branch_id", branchId)
        .in("status", ["available", "reserved"])
        .order("created_at", { ascending: false });
      return data ?? [];
    },
    enabled: !!branchId && !!session,
  });

  const { data: items = [] } = useQuery({
    queryKey: ["stock-take-items", session?.id],
    queryFn: async () => {
      const { data } = await supabase.from("stock_take_items").select("*").eq("session_id", session!.id);
      return data ?? [];
    },
    enabled: !!session?.id,
  });

  const checked = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of items as any[]) if (it.product_id) m.set(it.product_id, it.result);
    return m;
  }, [items]);

  const filtered = useMemo(() => {
    const nq = normalizeArabic(q.trim());
    if (!nq) return products as any[];
    return (products as any[]).filter((p) =>
      normalizeArabic(`${p.name} ${p.sku ?? ""}`).includes(nq));
  }, [products, q]);

  const startSession = async () => {
    if (!branchId) return toast.error("اختر الفرع");
    const { error } = await supabase.from("stock_take_sessions").insert({
      branch_id: branchId, started_by: user?.id ?? null,
    });
    if (error) return toast.error(error.message);
    toast.success("بدأت جلسة الجرد");
    qc.invalidateQueries({ queryKey: ["stock-take-open", branchId] });
  };

  const closeSession = async () => {
    if (!session) return;
    if (!confirm("إغلاق جلسة الجرد؟ لا يمكن التعديل بعدها.")) return;
    const { error } = await supabase.from("stock_take_sessions")
      .update({ status: "closed", closed_by: user?.id ?? null, closed_at: new Date().toISOString() })
      .eq("id", session.id);
    if (error) return toast.error(error.message);
    toast.success("تم إغلاق الجلسة");
    qc.invalidateQueries({ queryKey: ["stock-take-open", branchId] });
  };

  const mark = async (productId: string, result: "found" | "missing") => {
    if (!session) return;
    const existing = (items as any[]).find((i) => i.product_id === productId);
    const payload = { session_id: session.id, product_id: productId, result, checked_by: user?.id ?? null };
    const { error } = existing
      ? await supabase.from("stock_take_items").update(payload).eq("id", existing.id)
      : await supabase.from("stock_take_items").insert(payload);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["stock-take-items", session.id] });
  };

  const foundCount = (items as any[]).filter((i) => i.result === "found").length;
  const missingCount = (items as any[]).filter((i) => i.result === "missing").length;
  const remaining = products.length - checked.size;

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <header className="flex items-center gap-3">
        <div className="size-10 rounded-xl bg-gold-gradient flex items-center justify-center shadow-gold">
          <ClipboardCheck className="size-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-xl font-extrabold text-gold-gradient">الجرد الميداني</h1>
          <p className="text-xs text-muted-foreground">مرّ على القطع وأكّد وجودها قطعة بقطعة.</p>
        </div>
      </header>

      <Card>
        <CardContent className="pt-4 space-y-3">
          {isAdmin && (
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
              <SelectContent>
                {branches.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {!session ? (
            <Button className="w-full" size="lg" onClick={startSession} disabled={!branchId}>
              <Play className="size-4 ml-1" /> بدء جلسة جرد جديدة
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">بدأت: {formatDate(session.started_at)}</Badge>
              <Badge className="bg-status-available text-white border-0">موجود {foundCount}</Badge>
              <Badge className="bg-destructive text-destructive-foreground border-0">ناقص {missingCount}</Badge>
              <Badge variant="outline">متبقي {remaining}</Badge>
              <Button variant="outline" size="sm" className="mr-auto" onClick={closeSession}>
                <Lock className="size-4 ml-1" /> إغلاق الجلسة
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {session && (
        <>
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم أو SKU..." className="pr-9" />
          </div>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">قطع الفرع ({filtered.length})</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {filtered.map((p) => {
                const res = checked.get(p.id);
                return (
                  <div key={p.id} className="flex items-center gap-2 border-b border-border/60 pb-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{p.sku ?? "—"} · {p.karat ?? "—"}</p>
                    </div>
                    <Button size="icon" variant={res === "found" ? "default" : "secondary"} onClick={() => mark(p.id, "found")} aria-label="موجود">
                      <Check className="size-4" />
                    </Button>
                    <Button size="icon" variant={res === "missing" ? "destructive" : "secondary"} onClick={() => mark(p.id, "missing")} aria-label="ناقص">
                      <X className="size-4" />
                    </Button>
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-8">لا قطع مطابقة</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
