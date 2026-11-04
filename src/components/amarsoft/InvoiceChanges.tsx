// الفواتير الممسوحة والمعدّلة مع محتواها: قبل/بعد، وأين ذهبت قطع الفاتورة الممسوحة.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { sb, formatLD, formatGrams, tripoliToday } from "@/lib/amarsoft";

type Item = { tag?: string; code?: string; desc?: string; grams?: number; amount_dirhams?: number; sman?: string };
type Resold = { tag: string; in_stock: boolean | null; sold_on: string | null; sold_date: string | null; sold_dirhams: number | null };
type Change = {
  branch_code: string; branch_name: string; invoice_no: string; invoice_date: string; change: "deleted" | "amount" | "items";
  customer: string | null; old_net: number | null; new_net: number | null; old_items: Item[]; new_items: Item[] | null; resold: Resold[] | null;
};

const LABEL = {
  deleted: { text: "ممسوحة", cls: "bg-destructive text-destructive-foreground" },
  amount: { text: "تغيّر المبلغ", cls: "bg-amber-500 text-white" },
  items: { text: "تغيّرت القطع", cls: "bg-muted text-foreground" },
};

function daysAgo(n: number) {
  const d = new Date(`${tripoliToday()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export default function InvoiceChanges({ branch, compact }: { branch?: string; compact?: boolean }) {
  const [filter, setFilter] = useState<"deleted" | "edited">("deleted");
  const [days, setDays] = useState(60);
  const { data, isLoading } = useQuery({
    queryKey: ["amarsoft-invoice-changes", branch ?? null, days],
    queryFn: async () => {
      const { data, error } = await sb.rpc("amarsoft_invoice_changes", { p_from: daysAgo(days), p_to: tripoliToday(), p_branch: branch ?? null });
      if (error) throw error;
      return (data ?? []) as Change[];
    },
  });
  const rows = (data ?? []).filter((c) => (filter === "deleted" ? c.change === "deleted" : c.change !== "deleted"));
  const deleted = (data ?? []).filter((c) => c.change === "deleted").length;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1.5">
        <Button size="lg" variant={filter === "deleted" ? "destructive" : "outline"} onClick={() => setFilter("deleted")} className="text-base">
          الممسوحة ({deleted})
        </Button>
        <Button size="lg" variant={filter === "edited" ? "default" : "outline"} onClick={() => setFilter("edited")} className="text-base">
          المعدّلة ({(data?.length ?? 0) - deleted})
        </Button>
      </div>
      {!compact && (
        <div className="flex gap-1.5">
          {[30, 60, 180, 365].map((d) => (
            <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)}>آخر {d} يوم</Button>
          ))}
        </div>
      )}
      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : !rows.length ? (
        <Card className="p-4 text-center text-sm text-muted-foreground">لا شيء في هذه الفترة.</Card>
      ) : (
        rows.slice(0, compact ? 5 : 200).map((c) => <ChangeCard key={`${c.branch_code}-${c.invoice_no}-${c.change}`} c={c} />)
      )}
    </div>
  );
}

function Lines({ items, title, tone }: { items: Item[]; title: string; tone: "old" | "new" }) {
  return (
    <div className={`rounded-lg p-2 ${tone === "old" ? "bg-destructive/5" : "bg-status-available/5"}`}>
      <div className="text-xs font-bold mb-1">{title}</div>
      {items.map((it, i) => (
        <div key={i} className="flex justify-between gap-2 text-sm py-0.5">
          <span className="truncate">{it.desc || it.code || "—"} <span className="text-xs text-muted-foreground" dir="ltr">{it.tag}</span></span>
          <span className="shrink-0 text-xs">{formatGrams(it.grams)} · {formatLD(Math.abs(Number(it.amount_dirhams ?? 0)))}</span>
        </div>
      ))}
    </div>
  );
}

function ChangeCard({ c }: { c: Change }) {
  const diff = c.change === "amount" ? Number(c.new_net ?? 0) - Number(c.old_net ?? 0) : 0;
  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <Link to={`/pos-sales?q=${encodeURIComponent(c.invoice_no)}`} className="font-bold text-base">فاتورة #{c.invoice_no}</Link>
          <div className="text-xs text-muted-foreground">
            <Link to={`/branches/${c.branch_code}`} className="underline underline-offset-2">{c.branch_name}</Link> · {c.invoice_date}{c.customer ? ` · ${c.customer}` : ""}
          </div>
        </div>
        <Badge className={LABEL[c.change].cls}>{LABEL[c.change].text}</Badge>
      </div>

      {c.change === "deleted" ? (
        <>
          <div className="flex justify-between font-bold"><span>كانت قيمتها</span><span className="text-destructive">{formatLD(c.old_net)}</span></div>
          <Lines items={c.old_items} title="القطع التي كانت فيها" tone="old" />
          {!!c.resold?.length && (
            <div className="text-xs space-y-0.5">
              {c.resold.map((r) => (
                <div key={r.tag} dir="rtl">
                  <span dir="ltr" className="font-mono">{r.tag}</span>:{" "}
                  {r.sold_on ? <>بيعت لاحقاً في <Link className="underline" to={`/pos-sales?q=${r.sold_on}`}>#{r.sold_on}</Link> ({r.sold_date}) بـ {formatLD(r.sold_dirhams)}</>
                    : r.in_stock ? "رجعت للمخزون" : "غير موجودة في المخزون ولا في فاتورة أخرى ⚠️"}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {c.change === "amount" && (
            <div className="flex justify-between font-bold">
              <span>{formatLD(c.old_net)} ← {formatLD(c.new_net)}</span>
              <span className={diff < 0 ? "text-destructive" : "text-status-available"}>{diff > 0 ? "+" : ""}{formatLD(diff)}</span>
            </div>
          )}
          <Lines items={c.old_items} title="قبل التعديل" tone="old" />
          {c.new_items && <Lines items={c.new_items} title="الآن" tone="new" />}
        </>
      )}
    </Card>
  );
}
