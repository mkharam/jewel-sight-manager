// ربط قطع التطبيق بأمارسوفت: القطع القديمة اتسجلت بلا رقم التاق، فنقترح لكل قطعة قطعة أمارسوفت
// في نفس الفرع بنفس الوزن والعيار. المدير يأكد المقترحات دفعة وحدة، ويختار لما فيه أكثر من وحدة،
// ويكتب الرقم بيده (ولا يأرشف القطعة) لما ما فيش مطابق. بعد الربط، كل مزامنة تحوّل القطعة «مبيعة»
// وحدها لما تنباع في أمارسوفت.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Link2, Loader2 } from "lucide-react";
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

export default function AmarsoftLink() {
  const qc = useQueryClient();
  const confirm = useConfirm();
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
    const sure = data.filter((p) => p.candidates.length === 1 && uses.get(p.candidates[0].tag) === 1);
    const choose = data.filter((p) => p.candidates.length > 1 || (p.candidates.length === 1 && uses.get(p.candidates[0].tag)! > 1));
    const none = data.filter((p) => !p.candidates.length);
    return { sure, choose, none };
  }, [data]);

  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});

  const done = () => { qc.invalidateQueries({ queryKey: ["amarsoft-link"] }); setSkip(new Set()); setPicked({}); setTyped({}); };
  const link = useMutation({
    mutationFn: async (links: { id: string; tag: string }[]) => {
      const { data, error } = await sb.rpc("amarsoft_link_products", { p_links: links });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => { toast.success(`تم ربط ${n} قطعة بأمارسوفت`); done(); },
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

  const sureLinks = v.sure.filter((p) => !skip.has(p.id)).map((p) => ({ id: p.id, tag: p.candidates[0].tag }));

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Link2 className="size-7 text-primary" />ربط القطع بأمارسوفت</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          القطعة المربوطة تتحوّل «مبيعة» وحدها لما تنباع في أمارسوفت، ويبان عليها رقمها وفرعها. المقترحات بنفس الوزن (لين 0.005 جم) ونفس العيار في نفس الفرع.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : !data.length ? (
        <Card className="p-6 text-center"><Check className="size-10 mx-auto text-status-available" /><p className="font-bold mt-2">كل القطع المتوفرة مربوطة 👍</p></Card>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Card className="p-2.5"><div className="text-xs text-muted-foreground">مطابقة وحدة</div><div className="text-xl font-bold text-status-available">{v.sure.length}</div></Card>
            <Card className="p-2.5"><div className="text-xs text-muted-foreground">تبي تختار</div><div className="text-xl font-bold">{v.choose.length}</div></Card>
            <Card className="p-2.5"><div className="text-xs text-muted-foreground">ما لقيتلهاش</div><div className="text-xl font-bold text-destructive">{v.none.length}</div></Card>
          </div>

          {!!v.sure.length && (
            <Card className="p-3 space-y-2">
              <h2 className="text-lg font-bold">مطابقة وحدة ({v.sure.length})</h2>
              <p className="text-xs text-muted-foreground">كل قطعة لقيتلها قطعة وحدة بس بنفس الوزن والعيار. شيل العلامة على أي وحدة مش هي (قارن النوع)، ثم اربط الكل.</p>
              <Button size="lg" className="w-full h-12 text-base" disabled={!sureLinks.length || link.isPending}
                onClick={async () => { if (await confirm({ title: `ربط ${sureLinks.length} قطعة؟`, description: "تقدر تغيّر الرقم من صفحة القطعة بعدين.", confirmLabel: "اربط" })) link.mutate(sureLinks); }}>
                {link.isPending ? <Loader2 className="size-5 animate-spin" /> : `اربط ${sureLinks.length} قطعة`}
              </Button>
              {v.sure.map((p) => {
                const c = p.candidates[0], on = !skip.has(p.id);
                return (
                  <label key={p.id} className={`flex gap-2.5 items-center py-2 border-b last:border-0 cursor-pointer ${on ? "" : "opacity-50"}`}>
                    <input type="checkbox" checked={on} className="size-5 shrink-0"
                      onChange={() => setSkip((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} />
                    <PieceInfo p={p} />
                    <CandidateInfo c={c} />
                  </label>
                );
              })}
            </Card>
          )}

          {!!v.choose.length && (
            <Card className="p-3 space-y-2">
              <h2 className="text-lg font-bold">اختار القطعة الصحيحة ({v.choose.length})</h2>
              <p className="text-xs text-muted-foreground">فيه أكثر من قطعة بنفس الوزن، ولا نفس قطعة أمارسوفت تطابق أكثر من قطعة. اختار بالنوع وتاريخ الدخول.</p>
              {v.choose.map((p) => (
                <div key={p.id} className="py-2 border-b last:border-0 space-y-1.5">
                  <div className="flex gap-2.5 items-center"><PieceInfo p={p} /></div>
                  <div className="grid gap-1.5">
                    {p.candidates.map((c) => (
                      <button key={c.tag} onClick={() => setPicked((s) => ({ ...s, [p.id]: c.tag }))}
                        className={`rounded-lg border p-2 text-right ${picked[p.id] === c.tag ? "border-primary bg-primary/10" : "border-border"}`}>
                        <CandidateInfo c={c} wide />
                      </button>
                    ))}
                  </div>
                  <Button size="sm" disabled={!picked[p.id] || link.isPending} onClick={() => link.mutate([{ id: p.id, tag: picked[p.id] }])}>اربط المختارة</Button>
                </div>
              ))}
            </Card>
          )}

          {!!v.none.length && (
            <Card className="p-3 space-y-2">
              <h2 className="text-lg font-bold">ما لقيتلهاش مطابق ({v.none.length})</h2>
              <p className="text-xs text-muted-foreground">
                غالباً تباعت، ولا الوزن مكتوب غلط، ولا ما عندهاش وزن. اكتب رقم التاق اللي على الليبل واربطها، ولو مش موجودة في المحل أرشفها (تختفي من البحث وما تنمسحش).
              </p>
              {v.none.map((p) => (
                <div key={p.id} className="py-2 border-b last:border-0 space-y-1.5">
                  <div className="flex gap-2.5 items-center"><PieceInfo p={p} /></div>
                  <div className="flex gap-1.5">
                    <Input value={typed[p.id] ?? ""} onChange={(e) => setTyped((s) => ({ ...s, [p.id]: e.target.value }))}
                      inputMode="numeric" dir="ltr" placeholder="رقم التاق مثلاً 01001664" className="h-10" />
                    <Button disabled={!typed[p.id]?.trim() || link.isPending} onClick={() => link.mutate([{ id: p.id, tag: typed[p.id].trim() }])}>اربط</Button>
                    <Button variant="outline" disabled={archive.isPending}
                      onClick={async () => { if (await confirm({ title: "أرشفة القطعة؟", description: p.name, confirmLabel: "أرشفة" })) archive.mutate(p.id); }}>أرشفة</Button>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function PieceInfo({ p }: { p: Piece }) {
  const url = getImageUrl(p.thumb);
  return (
    <>
      <div className="size-14 shrink-0 rounded-lg bg-muted overflow-hidden">{url && <img src={url} alt="" loading="lazy" className="size-full object-cover" />}</div>
      <div className="min-w-0 flex-1">
        <div className="font-bold text-sm line-clamp-2 leading-tight">{p.name}</div>
        <div className="text-xs text-muted-foreground">
          {p.weight != null ? formatGrams(p.weight) : "بلا وزن"}{p.karat ? ` · ${p.karat}` : ""} · {p.branch_name ?? "—"}
        </div>
      </div>
    </>
  );
}

function CandidateInfo({ c, wide }: { c: Candidate; wide?: boolean }) {
  return (
    <div className={`${wide ? "" : "shrink-0 w-32"} text-xs text-left leading-snug`}>
      <div className="font-bold font-mono text-sm" dir="ltr">{c.tag}</div>
      <div>{c.type ?? "—"} · {c.karat} · {formatGrams(c.grams)}</div>
      <div className="text-muted-foreground">
        {c.same_branch ? "" : `فرع ${c.branch_code} · `}دخلت {c.received_on ?? "—"}{wide && c.supplier ? ` · ${c.supplier}` : ""}
      </div>
    </div>
  );
}
