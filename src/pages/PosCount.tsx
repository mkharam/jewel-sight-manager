// جرد أمارسوفت: امسح وسم كل قطعة في الفرع (بالكاميرا أو قارئ الباركود) فيظهر فوراً هل هي من
// مخزون الفرع في أمارسوفت، وكم بقي، وما هي القطع الناقصة والزائدة.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, CheckCircle2, ClipboardCheck, Loader2, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/components/ConfirmDialogProvider";
import ScanBoxOverlay from "@/components/ScanBoxOverlay";
import { useBoxedBarcodeScanner } from "@/lib/useBoxedBarcodeScanner";
import { sb, formatGrams, formatTripoli } from "@/lib/amarsoft";

type Count = { id: string; branch_code: string; started_at: string; closed_at: string | null };
type Result = { tag: string; result: "found" | "missing" | "extra"; type_name: string | null; karat: string | null; grams: number | null; in_branch: string | null; sold_on: string | null; scanned_at: string | null };
type Branch = { code: string; name: string };

export default function PosCount() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [branch, setBranch] = useState("");
  const [manual, setManual] = useState("");
  const [camera, setCamera] = useState(false);
  const [last, setLast] = useState<{ tag: string; ok: boolean; text: string } | null>(null);
  const [list, setList] = useState<"missing" | "extra" | "found">("missing");

  const branches = useQuery({
    queryKey: ["amarsoft-branch-map-names"],
    queryFn: async () => {
      const { data, error } = await sb.from("amarsoft_branch_map").select("code, branches(name)").order("code");
      if (error) throw error;
      return (data ?? []).map((b: { code: string; branches: { name: string } | null }) => ({ code: b.code, name: b.branches?.name ?? b.code })) as Branch[];
    },
  });
  const branchName = (c: string) => branches.data?.find((b) => b.code === c)?.name ?? c;

  const open = useQuery({
    queryKey: ["amarsoft-open-count"],
    queryFn: async () => {
      const { data, error } = await sb.from("amarsoft_counts").select("*").is("closed_at", null).order("started_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return (data ?? null) as Count | null;
    },
  });
  const count = open.data;

  const result = useQuery({
    queryKey: ["amarsoft-count-result", count?.id],
    enabled: !!count,
    queryFn: async () => {
      const { data, error } = await sb.rpc("amarsoft_count_result", { p_count_id: count!.id });
      if (error) throw error;
      return (data ?? []) as Result[];
    },
  });
  const stats = useMemo(() => {
    const r = result.data ?? [];
    const found = r.filter((x) => x.result === "found");
    const missing = r.filter((x) => x.result === "missing");
    const extra = r.filter((x) => x.result === "extra");
    return { found, missing, extra, expected: found.length + missing.length };
  }, [result.data]);

  const start = useMutation({
    mutationFn: async () => {
      const { error } = await sb.from("amarsoft_counts").insert({ branch_code: branch });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["amarsoft-open-count"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const busy = useRef(false);
  const scan = async (raw: string) => {
    const tag = raw.replace(/\D/g, "");
    if (!count || tag.length < 6 || busy.current) return;
    busy.current = true;
    try {
      const { error } = await sb.from("amarsoft_count_scans").upsert({ count_id: count.id, tag }, { onConflict: "count_id,tag", ignoreDuplicates: true });
      if (error) throw error;
      const { data } = await result.refetch();
      const row = (data ?? []).find((x) => x.tag === tag);
      const ok = row?.result === "found";
      const text = ok
        ? `${row?.type_name ?? ""} · ${row?.karat ?? ""}K · ${formatGrams(row?.grams)}`
        : row?.sold_on ? `مباعة في أمارسوفت ${row.sold_on}` : row?.in_branch ? `من فرع ${branchName(row.in_branch)}` : "غير موجودة في أمارسوفت";
      setLast({ tag, ok, text });
      if (navigator.vibrate) navigator.vibrate(ok ? 30 : [80, 60, 80]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      busy.current = false;
    }
  };

  const close = async () => {
    if (!count) return;
    const ok = await confirm({ title: "إنهاء الجرد؟", description: `ناقصة ${stats.missing.length} · زائدة ${stats.extra.length}`, confirmLabel: "إنهاء" });
    if (!ok) return;
    const { error } = await sb.from("amarsoft_counts").update({ closed_at: new Date().toISOString() }).eq("id", count.id);
    if (error) return toast.error(error.message);
    toast.success("انتهى الجرد");
    setLast(null);
    qc.invalidateQueries({ queryKey: ["amarsoft-open-count"] });
  };

  if (open.isLoading) return <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>;

  if (!count) {
    return (
      <div className="max-w-md mx-auto space-y-4">
        <h1 className="text-2xl font-bold flex items-center gap-2"><ClipboardCheck className="size-7 text-primary" />جرد أمارسوفت</h1>
        <p className="text-base text-muted-foreground">اختر الفرع ثم امسح وسم كل قطعة. يقارن التطبيق مع مخزون الفرع في أمارسوفت.</p>
        <Select value={branch} onValueChange={setBranch}>
          <SelectTrigger className="h-14 text-lg"><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
          <SelectContent>{branches.data?.map((b) => <SelectItem key={b.code} value={b.code} className="text-lg">{b.name}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="lg" className="w-full h-16 text-xl" disabled={!branch || start.isPending} onClick={() => start.mutate()}>ابدأ الجرد</Button>
      </div>
    );
  }

  const shown = list === "missing" ? stats.missing : list === "extra" ? stats.extra : stats.found;
  return (
    <div className="max-w-md mx-auto space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">جرد {branchName(count.branch_code)}</h1>
        <Button variant="outline" onClick={close}>إنهاء الجرد</Button>
      </div>

      <Card className="p-4 text-center bg-gold-soft border-primary/30">
        <div className="text-4xl font-bold text-primary">{stats.found.length} <span className="text-xl text-muted-foreground">/ {stats.expected}</span></div>
        <div className="text-sm text-muted-foreground mt-1">قطعة مُسحت من مخزون الفرع</div>
      </Card>

      {last && (
        <Card className={`p-4 flex items-center gap-3 ${last.ok ? "border-status-available bg-status-available/10" : "border-destructive bg-destructive/10"}`}>
          {last.ok ? <CheckCircle2 className="size-9 text-status-available shrink-0" /> : <XCircle className="size-9 text-destructive shrink-0" />}
          <div className="min-w-0">
            <div className="text-lg font-bold" dir="ltr" style={{ textAlign: "right" }}>{last.tag}</div>
            <div className="text-sm">{last.text}</div>
          </div>
        </Card>
      )}

      <Button size="lg" className="w-full h-16 text-xl" onClick={() => setCamera(true)}><Camera className="size-6 ml-2" />امسح بالكاميرا</Button>
      <form onSubmit={(e) => { e.preventDefault(); void scan(manual); setManual(""); }} className="flex gap-2">
        <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="أو اكتب رقم الوسم / قارئ الباركود" inputMode="numeric" dir="ltr" className="h-14 text-lg" autoFocus />
        <Button type="submit" size="lg" className="h-14">إضافة</Button>
      </form>

      <div className="grid grid-cols-3 gap-1.5">
        <Button size="lg" variant={list === "missing" ? "destructive" : "outline"} onClick={() => setList("missing")}>ناقصة {stats.missing.length}</Button>
        <Button size="lg" variant={list === "extra" ? "default" : "outline"} onClick={() => setList("extra")}>زائدة {stats.extra.length}</Button>
        <Button size="lg" variant={list === "found" ? "default" : "outline"} onClick={() => setList("found")}>موجودة {stats.found.length}</Button>
      </div>
      <Card className="divide-y">
        {shown.slice(0, 300).map((r) => (
          <div key={`${r.result}-${r.tag}`} className="flex justify-between gap-2 p-3 text-sm">
            <span className="font-mono font-bold" dir="ltr">{r.tag}</span>
            <span className="text-muted-foreground truncate">
              {r.type_name ?? "—"} · {r.karat ?? "?"}K · {formatGrams(r.grams)}
              {r.result === "extra" && (r.sold_on ? ` · مباعة ${r.sold_on}` : r.in_branch ? ` · فرع ${branchName(r.in_branch)}` : " · ليست في أمارسوفت")}
            </span>
          </div>
        ))}
        {!shown.length && <p className="p-4 text-center text-sm text-muted-foreground">لا شيء</p>}
      </Card>
      <p className="text-xs text-muted-foreground text-center">بدأ {formatTripoli(count.started_at)}</p>

      {camera && <CameraScanner onClose={() => setCamera(false)} onScan={scan} />}
    </div>
  );
}

function CameraScanner({ onClose, onScan }: { onClose: () => void; onScan: (tag: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const lastTag = useRef<{ tag: string; at: number } | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((s) => {
        stream = s;
        if (videoRef.current) { videoRef.current.srcObject = s; void videoRef.current.play(); setReady(true); }
      })
      .catch(() => { toast.error("تعذّر فتح الكاميرا"); onClose(); });
    return () => stream?.getTracks().forEach((t) => t.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // نفس الوسم أمام الكاميرا لا يُحسب مرتين خلال 3 ثوانٍ.
  useBoxedBarcodeScanner(videoRef, ready, (text) => {
    const now = Date.now();
    if (lastTag.current && lastTag.current.tag === text && now - lastTag.current.at < 3000) return;
    lastTag.current = { tag: text, at: now };
    onScan(text);
  });

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted className="w-full h-full object-contain" />
        <ScanBoxOverlay active={false} />
      </div>
      <Button size="lg" variant="secondary" className="m-4 h-16 text-xl safe-area-pb" onClick={onClose}><X className="size-6 ml-2" />إغلاق الكاميرا</Button>
    </div>
  );
}
