// خانة «التواصل» في صفحة الولاء (المدير العام): الزبائن اللي يستاهلو مكالمة ولا رسالة — ذهبي بلا بطاقة، 5 شريات
// (هدية 1,250 + 50 على القرام)، ذهبي عنده بطاقة. الرسالة تنفتح في واتساب جاهزة، وانت تبعتها بيدك، وبعدها «تم».
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { sb } from "@/lib/amarsoft";
import { waPhone } from "@/lib/loyalty";

type Row = {
  phone9: string; phone: string; full_name: string; branch_code: string; branch_name: string; purchase_days: number; total_ld: number;
  last_at: string; has_card: boolean; card_level: string | null; card_installed: boolean; five: boolean; gold: boolean; silver: boolean;
  contacted: string[];
};

const INSTALL = "https://take.cards/gOwTN";
const first = (n: string) => (n === "بلا اسم" ? "" : ` ${n.trim().split(/\s+/)[0]}`);

const GROUPS = [
  {
    key: "gold_no_card", label: "ذهبي بلا بطاقة", hint: "أهم ناس: شرياتهم 100,000 د.ل فما فوق وما عندهمش بطاقة.",
    pick: (r: Row) => r.gold && !r.has_card,
    text: (r: Row) => `مرحبا${first(r.full_name)} 💚\nمن مجوهرات مخرّم: لأنك من أغلى زبائننا، عندك بطاقة ولاء ذهبية بخصم 5% على كل شرية.\nركّبها على موبايلك من هنا وسجّل بنفس رقمك، وشرياتك القديمة تنحسبلك وحدها:\n${INSTALL}`,
  },
  {
    key: "five", label: "5 شريات", hint: "شروا في 5 أيام مختلفة أو أكثر: هدية 1,250 على الفاتورة + 50 على القرام.",
    pick: (r: Row) => r.five,
    text: (r: Row) => `مرحبا${first(r.full_name)} 💚\nمن مجوهرات مخرّم: كمّلت معانا 5 شريات، وعندك هدية في شريتك الجاية:\nخصم 1,250 د.ل على قيمة الفاتورة + خصم 50 د.ل على كل قرام.\n(الخصم على الشراء، مش كاش). نستنوك في أقرب فرع.`,
  },
  {
    key: "gold_card", label: "ذهبي عنده بطاقة", hint: "عندهم بطاقة MSTRMND وشرياتهم توصل ذهبي.",
    pick: (r: Row) => r.gold && r.has_card,
    text: (r: Row) => `مرحبا${first(r.full_name)} 💚\nبطاقتك في مجوهرات مخرّم ذهبية: خصم 5% على كل شرية. ورّي بطاقتك للموظف وقت الشراء. نستنوك.`,
  },
  {
    key: "silver_no_card", label: "فضي بلا بطاقة", hint: "شرياتهم بين 70,000 و100,000 وما عندهمش بطاقة.",
    pick: (r: Row) => r.silver && !r.has_card,
    text: (r: Row) => `مرحبا${first(r.full_name)} 💚\nمن مجوهرات مخرّم: عندك بطاقة ولاء فضية بخصم 3% على كل شرية، وقريب توصل الذهبية (5%).\nركّبها على موبايلك من هنا وسجّل بنفس رقمك:\n${INSTALL}`,
  },
] as const;

export default function LoyaltyOutreach() {
  const qc = useQueryClient();
  const [group, setGroup] = useState<(typeof GROUPS)[number]["key"]>("gold_no_card");
  const [hideDone, setHideDone] = useState(true);
  const { data, isLoading } = useQuery({
    queryKey: ["loyalty-outreach"],
    queryFn: async () => {
      const { data, error } = await sb.rpc("loyalty_outreach");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });
  const g = GROUPS.find((x) => x.key === group)!;
  const counts = useMemo(() => Object.fromEntries(GROUPS.map((x) => [x.key, (data ?? []).filter(x.pick).length])), [data]);
  const list = useMemo(() => (data ?? []).filter(g.pick).filter((r) => !hideDone || !r.contacted.includes(g.key)), [data, g, hideDone]);

  const mark = async (r: Row, done: boolean) => {
    const q = done
      ? sb.from("loyalty_contacts").upsert({ phone9: r.phone9, category: g.key })
      : sb.from("loyalty_contacts").delete().eq("phone9", r.phone9).eq("category", g.key);
    const { error } = await q;
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["loyalty-outreach"] });
  };
  const send = (r: Row) => {
    const ph = waPhone(r.phone);
    if (!ph) return toast.error("الرقم مش صالح");
    window.open(`https://wa.me/${ph}?text=${encodeURIComponent(g.text(r))}`, "_blank");
  };

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1.5">
        {GROUPS.map((x) => (
          <Button key={x.key} variant={group === x.key ? "default" : "outline"} onClick={() => setGroup(x.key)} className="h-auto py-2 flex-col">
            <span className="text-lg font-black tabular-nums">{counts[x.key] ?? 0}</span>
            <span className="text-xs">{x.label}</span>
          </Button>
        ))}
      </div>
      <Card className="p-3 space-y-2 text-sm">
        <p className="text-muted-foreground">{g.hint}</p>
        <p className="whitespace-pre-line rounded-md bg-muted/50 p-2 text-xs">{g.text({ full_name: "الاسم" } as Row)}</p>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> خبّي اللي تكلّمنا معاهم
        </label>
      </Card>
      {!list.length ? <Card className="p-8 text-center text-muted-foreground">ما فيش حد في القائمة هذي.</Card> : list.map((r) => {
        const done = r.contacted.includes(g.key);
        return (
          <Card key={r.phone9} className={`p-3 flex items-center gap-2 ${done ? "opacity-60" : ""}`}>
            <div className="flex-1 min-w-0">
              <p className="font-bold truncate">{r.full_name}</p>
              <p className="text-xs text-muted-foreground">
                <span dir="ltr">0{r.phone9}</span> · {r.branch_name} · {Math.round(r.total_ld).toLocaleString("en-US")} د.ل · {r.purchase_days} شرية
                · آخر شرية {new Date(r.last_at).toLocaleDateString("en-GB", { timeZone: "Africa/Tripoli" })}
                {r.has_card ? ` · بطاقته ${r.card_level ?? ""}${r.card_installed ? "" : " (مش مركّبة)"}` : ""}
              </p>
            </div>
            <Button size="icon" variant="outline" onClick={() => send(r)} aria-label="فتح الرسالة في واتساب"><MessageCircle className="size-4" /></Button>
            <Button size="icon" variant={done ? "default" : "outline"} onClick={() => mark(r, !done)} aria-label={done ? "إلغاء تم" : "تم التواصل"}>
              <Check className="size-4" />
            </Button>
          </Card>
        );
      })}
    </div>
  );
}
