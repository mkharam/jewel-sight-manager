// رفع جلسة تصوير: المصوّر يصوّر بالتلفون ليبل القطعة ثم صورها، ثم ليبل القطعة التالية وهكذا.
// نرفع كل الصور دفعة واحدة، فنرتّبها بوقت التصوير (EXIF)، ونقرأ الباركود من كل صورة: صورة فيها
// كود جديد = ليبل يبدأ قطعة جديدة، والصور بعده حتى الليبل التالي = صور نفس القطعة. الوزن والعيار
// والنوع من أمارسوفت. ثم شاشة مراجعة قبل الحفظ تنبّه لأي شيء غريب.
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { X, Images, Loader2, Trash2, AlertTriangle, Check, Tag } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { readTag } from "@/lib/tagReader";
import { exifDate } from "@/lib/exifDate";
import { normalizeDecimalInput } from "@/lib/constants";
import { saveCapturedPiece, addExtraPieceImage, analyzeCapturedPiece, indexExtraImage } from "@/lib/uploadRunner";

type Photo = { id: string; file: File; url: string; time: number; tag: string | null; isLabel: boolean; use: boolean };
type Info = { found: boolean; in_stock: boolean; karat: string | null; grams: number | null; type_name: string | null; existing: string | null };
type Group = { id: string; tag: string; photos: Photo[]; weight: string; karat: "18K" | "21K"; info: Info | null; state?: "saving" | "saved" | "error"; ai?: string | null | "pending" };

async function lookup(tag: string): Promise<Info | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).rpc("amarsoft_lookup_tag", { p_code: tag });
  const r = Array.isArray(data) ? data[0] : null;
  if (!r) return null;
  return { found: !!r.found, in_stock: !!r.in_stock, karat: r.karat, grams: r.grams != null ? Number(r.grams) : null, type_name: r.type_name, existing: r.existing_product_name };
}

const uid = () => Math.random().toString(36).slice(2, 10);

interface Props { open: boolean; onClose: () => void; userId: string; branchId: string | null; onFinished?: (ids: string[]) => void }

export default function SessionUpload({ open, onClose, userId, branchId, onFinished }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"pick" | "reading" | "review" | "saving" | "analyzing" | "done">("pick");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [groups, setGroups] = useState<Group[]>([]);
  const [defaultKarat, setDefaultKarat] = useState<"18K" | "21K">("18K");

  useEffect(() => {
    if (open) return;
    setGroups((gs) => { gs.forEach((g) => g.photos.forEach((p) => URL.revokeObjectURL(p.url))); return []; });
    setPhase("pick");
  }, [open]);

  const readAll = async (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    setPhase("reading");
    setProgress({ done: 0, total: files.length });
    const photos: Photo[] = [];
    for (const file of files) {
      const time = (await exifDate(file)) ?? file.lastModified;
      const tag = await readTag(file);
      photos.push({ id: uid(), file, url: URL.createObjectURL(file), time, tag, isLabel: false, use: true });
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }
    photos.sort((a, b) => a.time - b.time || a.file.name.localeCompare(b.file.name, undefined, { numeric: true }));

    // التجميع: كود جديد يبدأ قطعة جديدة وصورته ليبل (لا تُحفظ كصورة للقطعة)؛ صور بنفس الكود أو
    // بلا كود تتبع القطعة الحالية. صور قبل أول ليبل تصير مجموعة بلا كود (تنبيه).
    const gs: Group[] = [];
    for (const p of photos) {
      const cur = gs[gs.length - 1];
      if (p.tag && (!cur || cur.tag !== p.tag)) {
        gs.push({ id: uid(), tag: p.tag, photos: [{ ...p, isLabel: true, use: false }], weight: "", karat: defaultKarat, info: null });
      } else if (cur) {
        cur.photos.push(p);
      } else {
        gs.push({ id: uid(), tag: "", photos: [p], weight: "", karat: defaultKarat, info: null });
      }
    }
    // ليبل بلا صور بعده: غالباً القطعة صُوّرت مع ليبلها في نفس الصورة — نستعمل صورة الليبل.
    gs.forEach((g) => { if (!g.photos.some((p) => p.use)) g.photos.forEach((p) => { p.use = true; }); });

    await Promise.all(gs.filter((g) => g.tag).map(async (g) => {
      const info = await lookup(g.tag).catch(() => null);
      g.info = info;
      if (info?.found && info.grams) g.weight = String(info.grams);
      if (info?.karat === "21") g.karat = "21K";
      else if (info?.karat === "18") g.karat = "18K";
    }));
    setGroups(gs);
    setPhase("review");
  };

  const update = (id: string, patch: Partial<Group>) => setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  const togglePhoto = (gid: string, pid: string) =>
    setGroups((gs) => gs.map((g) => (g.id === gid ? { ...g, photos: g.photos.map((p) => (p.id === pid ? { ...p, use: !p.use } : p)) } : g)));
  const removeGroup = (id: string) => setGroups((gs) => gs.filter((g) => g.id !== id));
  // نقل كل صور المجموعة إلى المجموعة السابقة (مثلاً ليبل انقرا بالغلط من صورة قطعة).
  const mergeUp = (id: string) => setGroups((gs) => {
    const i = gs.findIndex((g) => g.id === id);
    if (i <= 0) return gs;
    const prev = gs[i - 1];
    const merged = { ...prev, photos: [...prev.photos, ...gs[i].photos.map((p) => ({ ...p, isLabel: false, use: true }))] };
    return [...gs.slice(0, i - 1), merged, ...gs.slice(i + 1)];
  });

  const relookup = async (g: Group, tag: string) => {
    update(g.id, { tag });
    if (!tag.trim()) return update(g.id, { info: null });
    const info = await lookup(tag.trim()).catch(() => null);
    setGroups((gs) => gs.map((x) => (x.id === g.id ? {
      ...x, info,
      weight: x.weight || (info?.grams ? String(info.grams) : ""),
      karat: info?.karat === "21" ? "21K" : info?.karat === "18" ? "18K" : x.karat,
    } : x)));
  };

  const tagCounts = groups.reduce<Record<string, number>>((m, g) => { if (g.tag) m[g.tag] = (m[g.tag] ?? 0) + 1; return m; }, {});
  const warningsOf = (g: Group): string[] => {
    const w: string[] = [];
    if (!g.tag) w.push("بلا كود — صور قبل أول ليبل أو الليبل لم يُقرأ");
    if (!g.photos.some((p) => p.use)) w.push("لا توجد صورة محددة للقطعة");
    if (g.tag && g.info && !g.info.found) w.push("الكود غير موجود في أمارسوفت");
    if (g.info?.found && !g.info.in_stock) w.push("القطعة مباعة/خارج المخزون في أمارسوفت");
    if (g.info?.existing) w.push(`مضافة من قبل: ${g.info.existing}`);
    if (g.tag && tagCounts[g.tag] > 1) w.push("نفس الكود مكرر في الجلسة");
    if (!g.weight) w.push("بلا وزن");
    return w;
  };

  // الحفظ أولاً لكل القطع (حتى لا يضيع شيء)، ثم التحليل بالذكاء الاصطناعي: يسمّي القطعة
  // ويحدد نوعها، ويصنع بصمة كل صورة (الرئيسية والإضافية) للبحث بالصورة.
  const saveAll = async () => {
    setPhase("saving");
    const ids: string[] = [];
    const toSave = groups.filter((g) => g.state !== "saved" && g.photos.some((p) => p.use)).length;
    const toAnalyze: { gid: string; file: File; saved: { productId: string; imageId: string }; extras: { file: File; imageId: string }[] }[] = [];
    for (const g of groups) {
      if (g.state === "saved") continue;
      const use = g.photos.filter((p) => p.use);
      if (!use.length) continue;
      update(g.id, { state: "saving" });
      try {
        const w = parseFloat(g.weight);
        const saved = await saveCapturedPiece(use[0].file, { userId, branchId, trayMode: false }, !isNaN(w) && w > 0 ? w : null, g.tag.trim() || null, g.karat);
        const extras: { file: File; imageId: string }[] = [];
        for (const extra of use.slice(1)) {
          try { extras.push({ file: extra.file, imageId: await addExtraPieceImage(saved.productId, extra.file, userId) }); }
          catch { toast.error("تعذّر حفظ صورة إضافية لإحدى القطع"); }
        }
        ids.push(saved.productId);
        toAnalyze.push({ gid: g.id, file: use[0].file, saved, extras });
        update(g.id, { state: "saved", ai: "pending" });
      } catch {
        update(g.id, { state: "error" });
      }
    }
    if (ids.length) { toast.success(`تم حفظ ${ids.length} قطعة — جارٍ التحليل والتسمية…`); onFinished?.(ids); }
    const failed = ids.length < toSave;
    if (failed) toast.error("بعض القطع لم تُحفظ — راجعها واضغط حفظ مرة أخرى");

    setPhase("analyzing");
    // قطعتان بالتوازي — أسرع دون إغراق مزوّد الذكاء الاصطناعي.
    let next = 0;
    const worker = async () => {
      while (next < toAnalyze.length) {
        const job = toAnalyze[next++];
        const name = await analyzeCapturedPiece(job.file, job.saved, { karat: true, itemType: false }).catch(() => null);
        for (const ex of job.extras) await indexExtraImage(ex.file, ex.imageId);
        update(job.gid, { ai: name });
      }
    };
    await Promise.all([worker(), worker()]);
    setPhase(failed ? "review" : "done");
  };

  if (!open) return null;
  const pieces = groups.filter((g) => g.photos.some((p) => p.use)).length;

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col" dir="rtl">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="font-bold">رفع جلسة تصوير (ليبل + صور)</h2>
        <button onClick={onClose} aria-label="إغلاق"><X className="size-5" /></button>
      </div>

      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
        onChange={(e) => { void readAll(e.target.files); e.target.value = ""; }} />

      {phase === "pick" && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="rounded-xl border bg-muted/40 p-4 text-sm space-y-2 leading-relaxed">
            <p className="font-semibold">طريقة التصوير:</p>
            <ol className="list-decimal pr-5 space-y-1">
              <li>صوّر <b>ليبل القطعة</b> قريباً وواضحاً في صورة لوحده.</li>
              <li>صوّر <b>القطعة</b> (صورة أو أكثر).</li>
              <li>انتقل للقطعة التالية: ليبلها ثم صورها… وهكذا.</li>
            </ol>
            <p className="text-muted-foreground text-xs">بعدها اختر كل الصور مرة واحدة — المنظومة ترتّبها بوقت التصوير وتربط كل قطعة بكودها ووزنها من أمارسوفت.</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">العيار إن لم يوجد في أمارسوفت</p>
            <div className="flex gap-2">
              {(["18K", "21K"] as const).map((k) => (
                <Button key={k} variant={defaultKarat === k ? "default" : "outline"} size="sm" onClick={() => setDefaultKarat(k)}>{k}</Button>
              ))}
            </div>
          </div>
          <Button className="h-12 w-full" onClick={() => inputRef.current?.click()}>
            <Images className="size-5 ml-2" /> اختر صور الجلسة
          </Button>
        </div>
      )}

      {phase === "reading" && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p>قراءة الباركود من الصور… {progress.done} / {progress.total}</p>
        </div>
      )}

      {(phase === "review" || phase === "saving" || phase === "analyzing" || phase === "done") && (
        <>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            <p className="text-sm text-muted-foreground">{pieces} قطعة — اضغط على صورة لاستبعادها أو تضمينها.</p>
            {groups.map((g, i) => {
              const warns = warningsOf(g);
              return (
                <div key={g.id} className={`rounded-xl border p-3 space-y-2 ${warns.length ? "border-amber-400" : ""}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-muted-foreground">#{i + 1}</span>
                    {g.ai && g.ai !== "pending" ? <span className="text-sm font-semibold text-primary">{g.ai}</span>
                      : g.info?.type_name && <span className="text-sm font-semibold">{g.info.type_name}</span>}
                    {g.ai === "pending" && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" />يحلل…</span>}
                    {g.state === "saved" && g.ai === null && <span className="text-xs text-muted-foreground">سيُحلل لاحقاً تلقائياً</span>}
                    <span className="flex-1" />
                    {g.state === "saving" && <Loader2 className="size-4 animate-spin" />}
                    {g.state === "saved" && <Check className="size-4 text-green-600" />}
                    {g.state === "error" && <AlertTriangle className="size-4 text-destructive" />}
                    {i > 0 && <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => mergeUp(g.id)} disabled={phase === "saving"}>ضمّ للسابقة</Button>}
                    <button onClick={() => removeGroup(g.id)} disabled={phase === "saving"} aria-label="حذف القطعة"><Trash2 className="size-4 text-destructive" /></button>
                  </div>
                  <div className="flex gap-2 overflow-x-auto">
                    {g.photos.map((p) => (
                      <button key={p.id} onClick={() => togglePhoto(g.id, p.id)} className="relative shrink-0">
                        <img src={p.url} alt="" className={`size-20 rounded-lg object-cover border ${p.use ? "border-primary" : "opacity-40 grayscale"}`} />
                        {p.isLabel && <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[9px] text-white flex items-center gap-0.5"><Tag className="size-2.5" />ليبل</span>}
                        {p.use && <Check className="absolute top-0.5 left-0.5 size-4 rounded-full bg-primary p-0.5 text-primary-foreground" />}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input dir="ltr" placeholder="الكود" defaultValue={g.tag} onBlur={(e) => { if (e.target.value !== g.tag) void relookup(g, e.target.value); }}
                      className="h-9 min-w-0 flex-1 rounded-md border px-2 text-sm font-mono" />
                    <input inputMode="decimal" placeholder="الوزن (جم)" value={g.weight} onChange={(e) => update(g.id, { weight: normalizeDecimalInput(e.target.value) })}
                      className="h-9 w-24 rounded-md border px-2 text-sm text-center" />
                    <button onClick={() => update(g.id, { karat: g.karat === "18K" ? "21K" : "18K" })} className="h-9 rounded-md border px-2 text-xs font-bold">{g.karat}</button>
                  </div>
                  {warns.length > 0 && (
                    <ul className="text-xs text-amber-700 space-y-0.5">
                      {warns.map((w) => <li key={w} className="flex items-center gap-1"><AlertTriangle className="size-3" />{w}</li>)}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
          <div className="border-t p-3 flex gap-2">
            {phase === "done" || phase === "analyzing" ? (
              <Button className="flex-1 h-11" onClick={onClose}>
                {phase === "analyzing" ? <><Loader2 className="size-4 animate-spin ml-2" /> جارٍ التحليل… (يمكنك الإغلاق، يكمل لاحقاً)</> : <><Check className="size-4 ml-2" /> تم</>}
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setPhase("pick")} disabled={phase === "saving"}>رجوع</Button>
                <Button className="flex-1 h-11" onClick={() => void saveAll()} disabled={phase === "saving" || !pieces}>
                  {phase === "saving" ? <Loader2 className="size-4 animate-spin ml-2" /> : <Check className="size-4 ml-2" />} حفظ الكل ({pieces})
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
