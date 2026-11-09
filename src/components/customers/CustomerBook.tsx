// قائمة العملاء المرتّبة (المدير العام): كل عميل بآخر زيارة، مجموع شرياته، سعر القرام آخر مرة، ومستواه وبطاقته.
// فلاتر بالمستوى والبطاقة وآخر زيارة والفرع، وترتيب بآخر زيارة ولا الأكثر شراء. الضغط على العميل يفتح ملفه.
import { useMemo, useState } from "react";
import { CreditCard, Loader2, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TIERS, Tier } from "@/lib/loyalty";
import { CustomerRow, daysSince, ld, sinceText, useCustomersOverview } from "@/lib/customers";

const VISITS = [
  { key: "all", label: "أي وقت" },
  { key: "m1", label: "جا آخر شهر", min: 0, max: 30 },
  { key: "m3", label: "من 1 لـ 3 شهور", min: 31, max: 90 },
  { key: "m6", label: "من 3 لـ 6 شهور", min: 91, max: 180 },
  { key: "m12", label: "من 6 لـ 12 شهر", min: 181, max: 365 },
  { key: "old", label: "غايب أكثر من سنة", min: 366, max: Infinity },
  { key: "never", label: "ما شراش بعد" },
] as const;

const SORTS = [
  { key: "last", label: "آخر زيارة" },
  { key: "total", label: "الأكثر شراء" },
  { key: "visits", label: "الأكثر زيارات" },
  { key: "name", label: "الاسم" },
] as const;

type VisitKey = (typeof VISITS)[number]["key"];
type SortKey = (typeof SORTS)[number]["key"];

export default function CustomerBook({ onOpen }: { onOpen: (r: CustomerRow) => void }) {
  const { data, isLoading } = useCustomersOverview();
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<Tier | "all">("all");
  const [card, setCard] = useState<"all" | "yes" | "no">("all");
  const [visit, setVisit] = useState<VisitKey>("all");
  const [branch, setBranch] = useState("all");
  const [sort, setSort] = useState<SortKey>("last");
  const [shown, setShown] = useState(50);

  const rows = useMemo(() => data ?? [], [data]);
  const counts = useMemo(() => {
    const c = { gold: 0, silver: 0, bronze: 0, cards: 0, active: 0 };
    for (const r of rows) {
      if (r.tier) c[r.tier]++;
      if (r.has_card) c.cards++;
      if (r.last_at && daysSince(r.last_at) <= 90) c.active++;
    }
    return c;
  }, [rows]);
  const branches = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (r.main_branch) m.set(r.main_branch, r.main_branch_name ?? r.main_branch);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const list = useMemo(() => {
    const term = q.trim();
    const digits = term.replace(/\D/g, "");
    const v = VISITS.find((x) => x.key === visit)!;
    const out = rows.filter((r) => {
      if (term && !r.full_name.includes(term) && !(digits.length >= 3 && (r.phone ?? "").replace(/\D/g, "").includes(digits))) return false;
      if (tier !== "all" && r.tier !== tier) return false;
      if (card === "yes" && !r.has_card) return false;
      if (card === "no" && r.has_card) return false;
      if (branch !== "all" && r.main_branch !== branch) return false;
      if (v.key === "never") return !r.last_at;
      if ("min" in v) {
        if (!r.last_at) return false;
        const d = daysSince(r.last_at);
        return d >= v.min && d <= v.max;
      }
      return true;
    });
    const time = (s: string | null) => (s ? new Date(s).getTime() : 0);
    out.sort((a, b) =>
      sort === "total" ? b.total_ld - a.total_ld
        : sort === "visits" ? b.visit_days - a.visit_days || b.total_ld - a.total_ld
          : sort === "name" ? a.full_name.localeCompare(b.full_name, "ar")
            : time(b.last_at) - time(a.last_at));
    return out;
  }, [rows, q, tier, card, visit, branch, sort]);

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-1.5">
        <button onClick={() => setTier("all")} className={`rounded-xl p-2 text-center border transition ${tier === "all" ? "ring-2 ring-primary" : ""}`}>
          <p className="text-xl font-black tabular-nums">{rows.length}</p>
          <p className="text-xs text-muted-foreground">الكل</p>
        </button>
        {(["gold", "silver", "bronze"] as Tier[]).map((t) => (
          <button key={t} onClick={() => setTier(tier === t ? "all" : t)}
            className={`rounded-xl p-2 text-center border transition ${tier === t ? "ring-2 ring-primary" : ""}`}>
            <p className="text-xl font-black tabular-nums">{counts[t]}</p>
            <p className="text-xs text-muted-foreground">{TIERS[t].label}</p>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {counts.active} جو آخر 3 شهور · {counts.cards} عندهم بطاقة ولاء. المستوى من مجموع شرياتهم في أمارسوفت.
      </p>

      <div className="grid grid-cols-3 gap-1.5">
        {([["all", "كل العملاء"], ["yes", "عنده بطاقة"], ["no", "بلا بطاقة"]] as const).map(([k, label]) => (
          <Button key={k} size="sm" variant={card === k ? "default" : "outline"} onClick={() => setCard(k)}>{label}</Button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <Select value={visit} onValueChange={(x) => setVisit(x as VisitKey)}>
          <SelectTrigger aria-label="آخر زيارة"><SelectValue /></SelectTrigger>
          <SelectContent>{VISITS.map((x) => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={branch} onValueChange={setBranch}>
          <SelectTrigger aria-label="الفرع"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الفروع</SelectItem>
            {branches.map(([code, name]) => <SelectItem key={code} value={code}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(x) => setSort(x as SortKey)}>
          <SelectTrigger aria-label="الترتيب"><SelectValue /></SelectTrigger>
          <SelectContent>{SORTS.map((x) => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم أو الهاتف" className="pr-9" />
      </div>
      <p className="text-xs text-muted-foreground">{list.length} عميل</p>

      {!list.length ? <Card className="p-8 text-center text-muted-foreground">ما فيش عميل مطابق</Card> : (
        <div className="space-y-2">
          {list.slice(0, shown).map((r) => <Row key={r.customer_id} r={r} onOpen={onOpen} />)}
          {list.length > shown && (
            <Button variant="ghost" className="w-full text-primary" onClick={() => setShown(shown + 50)}>عرض المزيد ({list.length - shown} باقي)</Button>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ r, onOpen }: { r: CustomerRow; onOpen: (r: CustomerRow) => void }) {
  const d = r.last_at ? daysSince(r.last_at) : null;
  const price = r.last_price18 ?? r.last_price21;
  return (
    <Card className="p-3 cursor-pointer hover:bg-muted/40 transition-colors" onClick={() => onOpen(r)}>
      <div className="flex items-center gap-2">
        <p className="font-bold truncate flex-1">{r.full_name}</p>
        {r.has_card && (
          <span className={`flex items-center gap-1 text-xs ${r.card_installed ? "text-primary" : "text-muted-foreground"}`}>
            <CreditCard className="size-3.5" />{r.stamps_now != null ? `${r.stamps_now}/5` : ""}
          </span>
        )}
        {r.tier && <span className={`text-xs px-2 py-0.5 rounded-full ${TIERS[r.tier].badge}`}>{TIERS[r.tier].label}</span>}
      </div>
      {d == null ? (
        <p className="text-xs text-muted-foreground mt-0.5">ما شراش بعد{r.has_card ? " · ركّب البطاقة" : ""}</p>
      ) : (
        <>
          <p className={`text-xs mt-0.5 ${d > 365 ? "text-destructive" : "text-muted-foreground"}`}>
            آخر زيارة {sinceText(d)}{r.last_branch_name ? ` · ${r.last_branch_name}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {ld(r.total_ld)} · {r.visit_days} زيارة{price ? ` · آخر قرام ${price.toLocaleString("en-US")}${r.last_price18 ? "" : " (21)"}` : ""}
          </p>
        </>
      )}
    </Card>
  );
}
