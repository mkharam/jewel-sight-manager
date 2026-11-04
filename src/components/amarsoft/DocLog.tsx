// سجل فواتير أمارسوفت: حذف وتعديل وطباعة، مع الوقت والجهاز. الحذف يرسل إشعاراً للمدير العام.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { sb, formatTripoli } from "@/lib/amarsoft";

type Ev = { branch_code: string; trn_type: string; trn_no: string; trn_date: string | null; status: string; at: string; user_name: string | null; machine: string | null };

const FILTERS = [
  { key: "D", label: "المحذوفة" },
  { key: "E", label: "المعدّلة" },
  { key: "all", label: "الكل" },
] as const;
const STATUS: Record<string, { label: string; cls: string }> = {
  D: { label: "حُذفت", cls: "bg-destructive text-destructive-foreground" },
  E: { label: "فُتحت للتعديل", cls: "bg-amber-500 text-white" },
  A: { label: "أُضيفت", cls: "bg-status-available text-white" },
  P: { label: "طُبعت", cls: "bg-muted text-foreground" },
};

export default function DocLog({ branchName }: { branchName: (code: string) => string }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("D");
  const { data, isLoading } = useQuery({
    queryKey: ["amarsoft-doc-log", filter],
    queryFn: async () => {
      let q = sb.from("amarsoft_doc_events").select("branch_code, trn_type, trn_no, trn_date, status, at, user_name, machine").eq("trn_type", "RSL");
      if (filter !== "all") q = q.eq("status", filter);
      const { data, error } = await q.order("at", { ascending: false }).limit(150);
      if (error) throw error;
      return (data ?? []) as Ev[];
    },
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1.5">
        {FILTERS.map((f) => (
          <Button key={f.key} size="lg" variant={filter === f.key ? "default" : "outline"} onClick={() => setFilter(f.key)} className="text-base">{f.label}</Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        يصلك إشعار عند حذف أي فاتورة بيع. «فُتحت للتعديل» تعني أن أحداً فتح الفاتورة للتعديل — حتى لو ألغى دون حفظ.
      </p>
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : !data?.length ? (
        <Card className="p-4 text-sm text-muted-foreground text-center">لا شيء هنا.</Card>
      ) : (
        <div className="space-y-2">
          {data.map((e, i) => (
            <Link key={i} to={`/pos-sales?q=${encodeURIComponent(e.trn_no)}`}>
              <Card className="p-3 flex items-center gap-3 mb-2">
                <Badge className={STATUS[e.status]?.cls}>{STATUS[e.status]?.label ?? e.status}</Badge>
                <div className="flex-1 min-w-0">
                  <div className="font-bold">فاتورة #{e.trn_no} · {branchName(e.branch_code)}</div>
                  <div className="text-xs text-muted-foreground truncate">{formatTripoli(e.at)} · {e.user_name || e.machine || "—"}</div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
