import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PackagePlus, Clock, ShoppingCart, PackageCheck, X, ImageIcon } from "lucide-react";
import { formatDate } from "@/lib/constants";
import { toast } from "sonner";

type ReorderStatus = "pending" | "ordered" | "received" | "cancelled";

const STATUS_META: Record<ReorderStatus, { label: string; class: string; icon: any }> = {
  pending:   { label: "بانتظار الطلب من المورد", class: "bg-amber-100 text-amber-900 border-amber-300", icon: Clock },
  ordered:   { label: "تم الطلب من المورد",       class: "bg-blue-100 text-blue-900 border-blue-300", icon: ShoppingCart },
  received:  { label: "وصلت",                     class: "bg-emerald-100 text-emerald-900 border-emerald-300", icon: PackageCheck },
  cancelled: { label: "ملغى",                      class: "bg-muted text-muted-foreground border-border", icon: X },
};

interface ReorderRequest {
  id: string;
  product_id: string | null;
  product_name_snapshot: string;
  branch_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  quantity: number;
  note: string | null;
  image_path: string | null;
  status: ReorderStatus;
  requested_by: string | null;
  created_at: string;
  branch?: { name: string } | null;
  requester?: { full_name: string } | null;
}

function ReorderThumb({ path }: { path: string }) {
  const { data: url } = useQuery({
    queryKey: ["reorder-image-url", path],
    queryFn: async () => {
      const { data } = await supabase.storage.from("inquiry-images").createSignedUrl(path, 3600);
      return data?.signedUrl ?? null;
    },
    staleTime: 55 * 60 * 1000,
  });
  return (
    <div className="size-14 rounded-lg overflow-hidden bg-muted shrink-0">
      {url ? (
        <img src={url} className="w-full h-full object-cover" alt="" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-muted-foreground">
          <ImageIcon className="size-5 opacity-40" />
        </div>
      )}
    </div>
  );
}

export default function Reorders() {
  const { roles } = useAuth();
  const canManage = roles.includes("admin") || roles.includes("manager");
  const [items, setItems] = useState<ReorderRequest[]>([]);
  const [tab, setTab] = useState<"pending" | "active" | "all">("pending");

  const load = async () => {
    const { data } = await supabase
      .from("product_reorder_requests")
      .select("*, branch:branches(name)")
      .order("created_at", { ascending: false })
      .limit(200);
    const list = (data ?? []) as any[];
    const ids = Array.from(new Set(list.map((i) => i.requested_by).filter(Boolean)));
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      const map = new Map((profs ?? []).map((p: any) => [p.id, p.full_name]));
      list.forEach((i) => { i.requester = { full_name: map.get(i.requested_by) ?? "—" }; });
    }
    setItems(list);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("reorder-requests-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "product_reorder_requests" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const filtered = useMemo(() => {
    if (tab === "all") return items;
    if (tab === "active") return items.filter((i) => i.status === "pending" || i.status === "ordered");
    return items.filter((i) => i.status === "pending");
  }, [items, tab]);

  const updateStatus = async (id: string, status: ReorderStatus) => {
    const { error } = await supabase.from("product_reorder_requests").update({ status }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("تم التحديث");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <PackagePlus className="size-5 text-primary" />
        <h1 className="text-xl font-bold">طلبات إعادة الطلب</h1>
      </div>

      <Tabs value={tab} onValueChange={(v: any) => setTab(v)}>
        <TabsList className="w-full grid grid-cols-3">
          <TabsTrigger value="pending">بانتظار الطلب</TabsTrigger>
          <TabsTrigger value="active">جارية</TabsTrigger>
          <TabsTrigger value="all">الكل</TabsTrigger>
        </TabsList>
        <TabsContent value={tab} className="space-y-2 mt-3">
          {filtered.length === 0 && (
            <div className="text-center py-12 text-muted-foreground bg-muted/30 rounded-xl">لا توجد طلبات</div>
          )}
          {filtered.map((r) => {
            const meta = STATUS_META[r.status];
            const Icon = meta.icon;
            return (
              <Card key={r.id} className="p-3 sm:p-4 space-y-2">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  {r.image_path && <ReorderThumb path={r.image_path} />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {r.product_id ? (
                        <Link to={`/products/${r.product_id}`} className="font-bold text-base hover:text-primary truncate">
                          {r.product_name_snapshot}
                        </Link>
                      ) : (
                        <span className="font-bold text-base truncate">{r.product_name_snapshot}</span>
                      )}
                      <Badge variant="outline" className={`${meta.class} gap-1`}>
                        <Icon className="size-3" /> {meta.label}
                      </Badge>
                      {r.quantity > 1 && <Badge variant="secondary">×{r.quantity}</Badge>}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      {r.branch?.name && <span>{r.branch.name} · </span>}
                      طلبها {r.requester?.full_name ?? "موظف"}
                    </div>
                    {(r.customer_name || r.customer_phone) && (
                      <p className="text-xs mt-1">👤 {r.customer_name} {r.customer_phone && `· ${r.customer_phone}`}</p>
                    )}
                    {r.note && <p className="text-xs mt-1 italic text-muted-foreground">{r.note}</p>}
                  </div>
                  <div className="text-left text-[11px] text-muted-foreground shrink-0">{formatDate(r.created_at)}</div>
                </div>
                {canManage && (r.status === "pending" || r.status === "ordered") && (
                  <div className="flex gap-2 flex-wrap pt-2 border-t border-border">
                    {r.status === "pending" && (
                      <Button size="sm" onClick={() => updateStatus(r.id, "ordered")} className="bg-gold-gradient text-primary-foreground">
                        تم الطلب من المورد
                      </Button>
                    )}
                    {r.status === "ordered" && (
                      <Button size="sm" onClick={() => updateStatus(r.id, "received")} className="bg-gold-gradient text-primary-foreground">
                        وصلت القطعة
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => updateStatus(r.id, "cancelled")}>إلغاء</Button>
                  </div>
                )}
              </Card>
            );
          })}
        </TabsContent>
      </Tabs>
    </div>
  );
}
