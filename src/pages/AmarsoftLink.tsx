// ربط قطع التطبيق بأمارسوفت: القطع القديمة اتسجلت بلا رقم التاق، فنقترح لكل قطعة قطعة أمارسوفت
// في نفس الفرع بنفس الوزن والعيار. ثلاث خانات: «مطابقة وحدة» تتأكد دفعة وحدة، «اختار» تختار فيها
// القطعة الصحيحة لكل وحدة، «ما لقيتلهاش» تكتب فيها الرقم بيدك ولا تأرشف. كل اللي اخترته ولا كتبته
// يتربط مرة وحدة من الزر اللي تحت. بعد الربط، كل مزامنة تحوّل القطعة «مبيعة» وحدها لما تنباع.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, HelpCircle, Link2, Loader2, SearchX } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getImageUrl } from "@/lib/constants";
import { useConfirm } from "@/components/ConfirmDialogProvider";
import { sb, formatGrams } from "@/lib/amarsoft";

type Candidate = { tag: string; branch_code: string; type: string | null; karat: string | null; grams: number; received_on: string | null; supplier: string | null; same_branch: boolean };
type Piece = { id: string; name: string; sku: string | null; weight: number | null; karat: string | null; branch_name: string | null; branch_code: string; thumb: string | null; candidates: Candidate[] };
type Tab = "sure" | "choose" | "none";

export default function AmarsoftLink() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>("sure");
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});

  const { data = [], isLoading } = useQuery({
    queryKey: ["amarsoft-link"],
    queryFn: async () => {
      const { data, error } = await sb.rpc("amarsoft_link_suggestions");
      if (error) throw error;
      return (data ?? []) as Piece[];
    },
  });

  // قطعة أمارسوفت وحدة مقترحة لأكثر من قطعة في التطبيق ما تتربطش أوتوماتيك — تروح لـ«اختار».
  const v = useMemo(() => {
    const uses = new Map<string, number>();
    for (const p of data) for (const c of p.candidates) uses.set(c.tag, (uses.get(c.tag) ?? 0) + 1);
    return {
      sure: data.filter((p) => p.candidates.length === 1 && uses.get(p.candidates[0].tag) === 1),
      choose: data.filter((p) => p.candidates.length > 1 || (p.candidates.length === 1 && uses.get(p.candidates[0].tag)! > 1)),
      none: data.filter((p) => !p.candidates.length),
    };
  }, [data]);

  // رقم مختار لقطعة ما يتختارش لقطعة ثانية.
  const takenBy = useMemo(() => new Map(Object.entries(picked).map(([id, tag]) => [tag, id])), [picked]);
  const sureLinks = v.sure.filter((p) => !skip.has(p.id)).map((p) => ({ id: p.id, tag: p.candidates[0].tag }));
  const pickLinks = [
    ...Object.entries(picked).map(([id, tag]) => ({ id, tag })),
    ...Object.entries(typed).filter(([, t]) => t.trim()).map(([id, t]) => ({ id, tag: t.trim() })),
  ];

  const reset = () => { qc.invalidateQueries({ queryKey: ["amarsoft-link"] }); setSkip(new Set()); setPicked({}); setTyped({}); };
  const link = useMutation({
    mutationFn: async (links: { id: string; tag: string }[]) => {
      const { data, error } = await sb.rpc("amarsoft_link_products", { p_links: links });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => { toast.success(`تم ربط ${n} قطعة بأمارسوفت`); reset(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const archive = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").update({ status: "archived" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("انأرشفت"); qc.invalidateQueries({ queryKey: ["amarsoft-link"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const linkAll = async (links: { id: string; tag: string }[]) => {
    if (await confirm({ title: `ربط ${links.length} قطعة؟`, description: "تقدر تغيّر الرقم من صفحة القطعة بعدين.", confirmLabel: "اربط" })) link.mutate(links);
  };

  const TABS: { key: Tab; label: string; n: number; icon: typeof Check; tone: string }[] = [
    { key: "sure", label: "مطابقة وحدة", n: v.sure.length, icon: CheckCircle2, tone: "text-status-available" },
    { key: "choose", label: "اختار", n: v.choose.length, icon: HelpCircle, tone: "text-primary" },
    { key: "none", label: "ما لقيتلهاش", n: v.none.length, icon: SearchX, tone: "text-destructive" },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-4 pb-24">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Link2 className="size-7 text-primary" />ربط القطع بأمارسوفت</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          القطعة المربوطة تتحوّل «مبيعة» وحدها لما تنباع في أمارسوفت. المقترحات بنفس الوزن (لين 0.005 جم) ونفس العيار في نفس الفرع — قارن النوع والصورة قبل ما تربط.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : !data.length ? (
        <Card className="p-6 text-center"><Check className="size-10 mx-auto text-status-available" /><p className="font-bold mt-2">كل القطع المتوفرة مربوطة 👍</p></Card>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`rounded-xl border p-2.5 text-center transition-colors ${tab === t.key ? "border-primary bg-primary/10" : "border-border bg-card"}`}>
                <t.icon className={`size-5 mx-auto ${t.tone}`} />
                <div className={`text-xl font-bold ${t.tone}`}>{t.n}</div>
                <div className="text-xs">{t.label}</div>
              </button>
            ))}
          </div>

          {tab === "sure" && (
            !v.sure.length ? <Empty text="ما فيش مطابقات أكيدة باقية." /> : (
              <Card className="p-3 space-y-2">
                <p className="text-xs text-muted-foreground">كل قطعة لقيتلها قطعة وحدة بس بنفس الوزن والعيار. شيل العلامة على أي وحدة مش هي (قارن النوع)، ثم اربطهم.</p>
                <div className="flex gap-2">
                  <Button size="lg" className="flex-1 h-12 text-base" disabled={!sureLinks.length || link.isPending} onClick={() => linkAll(sureLinks)}>
                    {link.isPending ? <Loader2 className="size-5 animate-spin" /> : `اربط ${sureLinks.length} قطعة`}
                  </Button>
                  <Button size="lg" variant="outline" className="h-12" onClick={() => setSkip(skip.size ? new Set() : new Set(v.sure.map((p) => p.id)))}>
                    {skip.size ? "علّم الكل" : "شيل الكل"}
                  </Button>
                </div>
                {v.sure.map((p) => {
                  const on = !skip.has(p.id);
                  return (
                    <label key={p.id} className={`flex gap-2.5 items-center rounded-xl border p-2 cursor-pointer ${on ? "border-status-available/50 bg-status-available/5" : "border-border opacity-60"}`}>
                      <input type="checkbox" checked={on} className="size-5 shrink-0 accent-[hsl(var(--primary))]"
                        onChange={() => setSkip((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} />
                      <PieceInfo p={p} />
                      <CandidateInfo c={p.candidates[0]} />
                    </label>
                  );
                })}
              </Card>
            )
          )}

          {tab === "choose" && (
            !v.choose.length ? <Empty text="ما فيش قطع تبي اختيار." /> : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">فيه أكثر من قطعة بنفس الوزن، ولا نفس قطعة أمارسوفت تطابق أكثر من قطعة. اضغط على الصحيحة لكل وحدة (ولا اضغط عليها مرة ثانية تلغيها)، ثم «اربط كل المختارين» تحت.</p>
                {v.choose.map((p) => (
                  <Card key={p.id} className={`p-2.5 space-y-2 ${picked[p.id] ? "border-primary" : ""}`}>
                    <div className="flex gap-2.5 items-center"><PieceInfo p={p} />{picked[p.id] && <Check className="size-6 text-primary shrink-0" />}</div>
                    <div className="grid gap-1.5">
                      {p.candidates.map((c) => {
                        const mine = picked[p.id] === c.tag;
                        const other = !mine && takenBy.has(c.tag);
                        return (
                          <button key={c.tag} disabled={other}
                            onClick={() => setPicked((s) => { const n = { ...s }; if (mine) delete n[p.id]; else n[p.id] = c.tag; return n; })}
                            className={`rounded-lg border p-2 text-right flex items-center gap-2 ${mine ? "border-primary bg-primary/10" : other ? "border-border opacity-40" : "border-border active:bg-muted/50"}`}>
                            <span className={`size-5 shrink-0 rounded-full border-2 ${mine ? "border-primary bg-primary" : "border-muted-foreground/40"}`} />
                            <CandidateInfo c={c} wide />
                            {other && <span className="text-[10px] text-muted-foreground mr-auto">مختارة لقطعة ثانية</span>}
                          </button>
                        );
                      })}
                    </div>
                  </Card>
                ))}
              </div>
            )
          )}

          {tab === "none" && (
            !v.none.length ? <Empty text="كل القطع لقيتلها مطابق." /> : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  غالباً تباعت، ولا الوزن مكتوب غلط، ولا ما عندهاش وزن. اكتب رقم التاق اللي على الليبل (يتربط مع «اربط كل المختارين»)، ولو مش موجودة في المحل أرشفها — تختفي من البحث وما تنمسحش.
                </p>
                {v.none.map((p) => (
                  <Card key={p.id} className={`p-2.5 space-y-2 ${typed[p.id]?.trim() ? "border-primary" : ""}`}>
                    <div className="flex gap-2.5 items-center"><PieceInfo p={p} /></div>
                    <div className="flex gap-1.5">
                      <Input value={typed[p.id] ?? ""} onChange={(e) => setTyped((s) => ({ ...s, [p.id]: e.target.value }))}
                        inputMode="numeric" dir="ltr" placeholder="رقم التاق مثلاً 01001664" className="h-11 text-base" />
                      <Button variant="outline" className="h-11" disabled={archive.isPending}
                        onClick={async () => { if (await confirm({ title: "أرشفة القطعة؟", description: p.name, confirmLabel: "أرشفة" })) archive.mutate(p.id); }}>أرشفة</Button>
                    </div>
                  </Card>
                ))}
              </div>
            )
          )}
        </>
      )}

      {pickLinks.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-4 z-30 px-4">
          <div className="max-w-2xl mx-auto flex gap-2 rounded-2xl border bg-card p-2 shadow-lg">
            <Button size="lg" className="flex-1 h-12 text-base" disabled={link.isPending} onClick={() => linkAll(pickLinks)}>
              {link.isPending ? <Loader2 className="size-5 animate-spin" /> : `اربط كل المختارين (${pickLinks.length})`}
            </Button>
            <Button size="lg" variant="ghost" className="h-12" onClick={() => { setPicked({}); setTyped({}); }}>إلغاء</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <Card className="p-6 text-center text-muted-foreground">{text}</Card>;
}

function PieceInfo({ p }: { p: Piece }) {
  const url = getImageUrl(p.thumb);
  return (
    <>
      <div className="size-16 shrink-0 rounded-lg bg-muted overflow-hidden">{url && <img src={url} alt="" loading="lazy" className="size-full object-cover" />}</div>
      <div className="min-w-0 flex-1">
        <div className="font-bold text-sm line-clamp-2 leading-tight">{p.name}</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {p.weight != null ? formatGrams(p.weight) : "بلا وزن"}{p.karat ? ` · عيار ${p.karat}` : ""} · {p.branch_name ?? "—"}
        </div>
      </div>
    </>
  );
}

function CandidateInfo({ c, wide }: { c: Candidate; wide?: boolean }) {
  return (
    <div className={`${wide ? "flex-1 min-w-0" : "shrink-0 w-32 text-left"} text-xs leading-snug`}>
      <div className="font-bold font-mono text-sm" dir="ltr">{c.tag}</div>
      <div>{c.type ?? "—"} · {c.karat} · {formatGrams(c.grams)}</div>
      <div className="text-muted-foreground truncate">
        {c.same_branch ? "" : `فرع ${c.branch_code} · `}دخلت {c.received_on ?? "—"}{wide && c.supplier ? ` · ${c.supplier}` : ""}
      </div>
    </div>
  );
}
