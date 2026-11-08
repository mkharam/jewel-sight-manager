// الساعات: صفحة خاصة، بعيدة على بضاعة الذهب (جدول watches وحده، ما تطلعش في بحث القطع).
// الموظف يشوف الساعات الموجودة بصورها وأسعارها وفروعها؛ المدير والمشرف يضيفوا ويعدّلوا.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2, Pencil, Plus, Search, Trash2, Watch } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isManagerOrAdmin, useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useConfirm } from "@/components/ConfirmDialogProvider";
import { formatCurrency, getImageUrl, normalizeDecimalInput } from "@/lib/constants";
import { compressImage, makeThumbnail } from "@/lib/image-compress";
import { removeUnreferencedFiles, uploadProductImage } from "@/lib/productImages";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any; // جدول watches جديد ومش في الأنواع المولّدة بعد.

type Gender = "men" | "women" | "unisex";
type Status = "available" | "reserved" | "sold";
type WatchRow = {
  id: string; brand: string; model: string | null; reference: string | null; gender: Gender | null;
  movement: string | null; color: string | null; price: number | null; promo_price: number | null;
  quantity: number; status: Status; branch_id: string | null; notes: string | null;
  photo_path: string | null; thumb_path: string | null; created_at: string;
  branch: { name: string } | null;
};
type Branch = { id: string; name: string };

const GENDER: Record<Gender, string> = { men: "رجالي", women: "نسائي", unisex: "للجنسين" };
const STATUS: Record<Status, { label: string; cls: string }> = {
  available: { label: "متوفرة", cls: "bg-status-available text-white" },
  reserved: { label: "محجوزة", cls: "bg-status-reserved text-white" },
  sold: { label: "تباعت", cls: "bg-status-sold text-white" },
};
const MOVEMENTS = ["أوتوماتيك", "كوارتز", "يدوي", "ذكية"];
const SORTS = [{ key: "new", label: "الأحدث" }, { key: "low", label: "الأرخص" }, { key: "high", label: "الأغلى" }] as const;

const price = (w: WatchRow) => Number(w.promo_price ?? w.price ?? 0);
const title = (w: Pick<WatchRow, "brand" | "model">) => [w.brand, w.model].filter(Boolean).join(" ");
const hasPromo = (w: WatchRow) => w.promo_price != null && w.price != null && Number(w.promo_price) < Number(w.price);

export default function Watches() {
  const { roles } = useAuth();
  const canEdit = isManagerOrAdmin(roles);
  const [q, setQ] = useState("");
  const [branch, setBranch] = useState("all");
  const [gender, setGender] = useState<Gender | "all">("all");
  const [sort, setSort] = useState<(typeof SORTS)[number]["key"]>("new");
  const [showSold, setShowSold] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<WatchRow | "new" | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["watches", showSold],
    queryFn: async () => {
      let qy = db.from("watches").select("*, branch:branches(name)").order("created_at", { ascending: false }).limit(2000);
      if (!showSold) qy = qy.neq("status", "sold");
      const { data, error } = await qy;
      if (error) throw error;
      return (data ?? []) as WatchRow[];
    },
  });
  const { data: branchList = [] } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => ((await supabase.from("branches").select("id,name").order("name")).data ?? []) as Branch[],
  });

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of rows) if (w.branch_id) m.set(w.branch_id, (m.get(w.branch_id) ?? 0) + 1);
    return m;
  }, [rows]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    let out = rows.filter((w) =>
      (branch === "all" || w.branch_id === branch) && (gender === "all" || w.gender === gender) &&
      (!term || [w.brand, w.model, w.reference, w.color, w.notes].some((s) => s?.toLowerCase().includes(term))));
    if (sort === "low") out = [...out].sort((a, b) => price(a) - price(b));
    if (sort === "high") out = [...out].sort((a, b) => price(b) - price(a));
    return out;
  }, [rows, q, branch, gender, sort]);

  const open = rows.find((w) => w.id === openId) ?? null;
  const available = rows.filter((w) => w.status === "available").reduce((t, w) => t + Number(w.quantity || 1), 0);

  return (
    <div className="max-w-3xl mx-auto space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Watch className="size-7 text-primary" />الساعات</h1>
          <p className="text-sm text-muted-foreground">{available} ساعة متوفرة في الفروع</p>
        </div>
        {canEdit && <Button size="lg" onClick={() => setEditing("new")}><Plus className="size-5" />إضافة ساعة</Button>}
      </div>

      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-5 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالماركة أو الموديل أو الرقم" className="h-12 pr-10 text-base" />
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        <Button size="sm" variant={branch === "all" ? "default" : "outline"} onClick={() => setBranch("all")} className="shrink-0">كل الفروع</Button>
        {branchList.filter((b) => counts.has(b.id)).map((b) => (
          <Button key={b.id} size="sm" variant={branch === b.id ? "default" : "outline"} onClick={() => setBranch(b.id)} className="shrink-0">
            {b.name} ({counts.get(b.id)})
          </Button>
        ))}
      </div>
      <div className="flex gap-1.5 flex-wrap items-center">
        {(["all", "men", "women", "unisex"] as const).map((g) => (
          <Button key={g} size="sm" variant={gender === g ? "secondary" : "ghost"} onClick={() => setGender(g)}>{g === "all" ? "الكل" : GENDER[g]}</Button>
        ))}
        <span className="mx-1 h-5 w-px bg-border" />
        {SORTS.map((s) => (
          <Button key={s.key} size="sm" variant={sort === s.key ? "secondary" : "ghost"} onClick={() => setSort(s.key)}>{s.label}</Button>
        ))}
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground mr-auto">
          <input type="checkbox" checked={showSold} onChange={(e) => setShowSold(e.target.checked)} className="size-4" />المباعة
        </label>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : !rows.length ? (
        <Card className="p-6 text-center space-y-2">
          <Watch className="size-10 mx-auto text-muted-foreground" />
          <p className="font-bold">ما فيش ساعات مسجّلة لين توا</p>
          <p className="text-sm text-muted-foreground">
            {canEdit ? "اضغط «إضافة ساعة»، صوّرها واكتب الماركة والسعر، وتطلع هنا لكل الموظفين." : "المدير أو المشرف يضيف الساعات، وتطلع هنا."}
          </p>
        </Card>
      ) : !shown.length ? (
        <p className="text-center text-muted-foreground py-8">ما فيش ساعة تطابق البحث</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {shown.map((w) => {
            const url = getImageUrl(w.thumb_path || w.photo_path);
            return (
              <button key={w.id} onClick={() => setOpenId(w.id)} className="text-right">
                <Card className="overflow-hidden h-full active:bg-muted/40">
                  <div className="aspect-square bg-muted relative">
                    {url ? <img src={url} alt={title(w)} loading="lazy" className="w-full h-full object-cover" />
                      : <Watch className="size-10 text-muted-foreground absolute inset-0 m-auto" />}
                    {w.status !== "available" && (
                      <span className={`absolute top-1.5 right-1.5 rounded-full px-2 py-0.5 text-[11px] ${STATUS[w.status].cls}`}>{STATUS[w.status].label}</span>
                    )}
                    {hasPromo(w) && <span className="absolute top-1.5 left-1.5 rounded-full px-2 py-0.5 text-[11px] bg-destructive text-white">تخفيض</span>}
                  </div>
                  <div className="p-2 space-y-0.5">
                    <div className="font-bold leading-tight line-clamp-2">{title(w)}</div>
                    <div className="text-lg font-bold text-primary">{w.price == null && w.promo_price == null ? <span className="text-sm text-muted-foreground font-normal">السعر مش مسجّل</span> : formatCurrency(price(w))}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {w.branch?.name ?? "—"}{w.gender ? ` · ${GENDER[w.gender]}` : ""}{w.quantity > 1 ? ` · ${w.quantity} حبات` : ""}
                    </div>
                  </div>
                </Card>
              </button>
            );
          })}
        </div>
      )}

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[92dvh] overflow-y-auto pb-8">
          {open && <WatchDetail w={open} canEdit={canEdit} onEdit={() => { setEditing(open); setOpenId(null); }} onClose={() => setOpenId(null)} />}
        </SheetContent>
      </Sheet>
      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[92dvh] overflow-y-auto pb-8">
          {editing && <WatchForm w={editing === "new" ? null : editing} branches={branchList} onDone={() => setEditing(null)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "") return null;
  return <div className="flex justify-between py-2 border-b last:border-0"><span className="text-muted-foreground">{label}</span><span className="font-semibold">{value}</span></div>;
}

function WatchDetail({ w, canEdit, onEdit, onClose }: { w: WatchRow; canEdit: boolean; onEdit: () => void; onClose: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const url = getImageUrl(w.photo_path);
  const setStatus = useMutation({
    mutationFn: async (status: Status) => {
      const { error } = await db.from("watches").update({ status }).eq("id", w.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("تم"); qc.invalidateQueries({ queryKey: ["watches"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await db.from("watches").delete().eq("id", w.id);
      if (error) throw error;
      await removeUnreferencedFiles([w.photo_path, w.thumb_path]);
    },
    onSuccess: () => { toast.success("انمسحت"); onClose(); qc.invalidateQueries({ queryKey: ["watches"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <SheetHeader className="text-right"><SheetTitle className="text-xl">{title(w)}</SheetTitle></SheetHeader>
      <div className="aspect-square max-h-[45dvh] mx-auto bg-muted rounded-xl overflow-hidden flex items-center justify-center">
        {url ? <img src={url} alt={title(w)} className="w-full h-full object-contain" /> : <Watch className="size-16 text-muted-foreground" />}
      </div>
      <div className="text-center">
        <div className="text-3xl font-bold text-primary">{w.price == null && w.promo_price == null ? "السعر مش مسجّل" : formatCurrency(price(w))}</div>
        {hasPromo(w) && <div className="text-sm text-muted-foreground line-through">{formatCurrency(w.price)}</div>}
        <span className={`inline-block mt-1 rounded-full px-3 py-0.5 text-sm ${STATUS[w.status].cls}`}>{STATUS[w.status].label}</span>
      </div>
      <Card className="px-3 text-sm">
        <Row label="الفرع" value={w.branch?.name} />
        <Row label="الماركة" value={w.brand} />
        <Row label="الموديل" value={w.model} />
        <Row label="الرقم المرجعي" value={w.reference && <span dir="ltr">{w.reference}</span>} />
        <Row label="لمين" value={w.gender && GENDER[w.gender]} />
        <Row label="الحركة" value={w.movement} />
        <Row label="اللون" value={w.color} />
        <Row label="العدد" value={w.quantity > 1 ? `${w.quantity} حبات` : null} />
        <Row label="ملاحظات" value={w.notes} />
      </Card>
      {canEdit && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(STATUS) as Status[]).map((s) => (
              <Button key={s} variant={w.status === s ? "default" : "outline"} disabled={setStatus.isPending} onClick={() => setStatus.mutate(s)}>{STATUS[s].label}</Button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button size="lg" variant="secondary" onClick={onEdit}><Pencil className="size-4" />تعديل</Button>
            <Button size="lg" variant="outline" className="text-destructive" disabled={remove.isPending}
              onClick={async () => { if (await confirm({ title: "مسح الساعة؟", description: title(w), confirmLabel: "مسح", destructive: true })) remove.mutate(); }}>
              <Trash2 className="size-4" />مسح
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function WatchForm({ w, branches, onDone }: { w: WatchRow | null; branches: Branch[]; onDone: () => void }) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const [f, setF] = useState({
    brand: w?.brand ?? "", model: w?.model ?? "", reference: w?.reference ?? "", gender: (w?.gender ?? "") as Gender | "",
    movement: w?.movement ?? "", color: w?.color ?? "", price: w?.price?.toString() ?? "", promo_price: w?.promo_price?.toString() ?? "",
    quantity: String(w?.quantity ?? 1), branch_id: w?.branch_id ?? profile?.branch_id ?? "", notes: w?.notes ?? "",
  });
  const [file, setFile] = useState<File | null>(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : getImageUrl(w?.photo_path)), [file, w?.photo_path]);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const num = (v: string) => (v.trim() ? Number(v) : null);

  const save = useMutation({
    mutationFn: async () => {
      if (!f.brand.trim()) throw new Error("اكتب الماركة");
      if (!f.branch_id) throw new Error("اختار الفرع");
      const id = w?.id ?? crypto.randomUUID();
      const row: Record<string, unknown> = {
        brand: f.brand.trim(), model: f.model.trim() || null, reference: f.reference.trim() || null, gender: f.gender || null,
        movement: f.movement || null, color: f.color.trim() || null, price: num(f.price), promo_price: num(f.promo_price),
        quantity: Math.max(0, Math.round(Number(f.quantity) || 1)), branch_id: f.branch_id, notes: f.notes.trim() || null,
      };
      if (file) {
        const stamp = Date.now();
        const full = await compressImage(file);
        const thumb = await makeThumbnail(file);
        row.photo_path = `watches/${id}/${stamp}.jpg`;
        await uploadProductImage(row.photo_path as string, full);
        if (thumb) { row.thumb_path = `watches/${id}/${stamp}-thumb.jpg`; await uploadProductImage(row.thumb_path as string, thumb); }
        else row.thumb_path = null;
      }
      const { error } = w
        ? await db.from("watches").update(row).eq("id", id)
        : await db.from("watches").insert({ ...row, id });
      if (error) throw error;
      if (w && file) await removeUnreferencedFiles([w.photo_path, w.thumb_path]);
    },
    onSuccess: () => { toast.success(w ? "تم التعديل" : "تمت إضافة الساعة"); qc.invalidateQueries({ queryKey: ["watches"] }); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const chip = (active: boolean) => (active ? "default" : "outline") as "default" | "outline";
  return (
    <div className="space-y-3">
      <SheetHeader className="text-right"><SheetTitle className="text-xl">{w ? "تعديل ساعة" : "إضافة ساعة"}</SheetTitle></SheetHeader>

      <label className="block cursor-pointer">
        <div className="aspect-[4/3] bg-muted rounded-xl overflow-hidden flex flex-col items-center justify-center gap-1 border-2 border-dashed border-border">
          {preview ? <img src={preview} alt="" className="w-full h-full object-contain" />
            : <><Camera className="size-10 text-muted-foreground" /><span className="text-sm text-muted-foreground">صوّر الساعة ولا اختار صورة</span></>}
        </div>
        <input type="file" accept="image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm font-semibold col-span-2">الماركة *
          <Input value={f.brand} onChange={(e) => set("brand", e.target.value)} placeholder="مثلاً Rolex، Casio" className="h-12 text-base mt-1" />
        </label>
        <label className="text-sm font-semibold">الموديل
          <Input value={f.model} onChange={(e) => set("model", e.target.value)} className="h-12 text-base mt-1" />
        </label>
        <label className="text-sm font-semibold">الرقم المرجعي
          <Input value={f.reference} onChange={(e) => set("reference", e.target.value)} dir="ltr" className="h-12 text-base mt-1" />
        </label>
      </div>

      <div>
        <p className="text-sm font-semibold mb-1">لمين</p>
        <div className="grid grid-cols-3 gap-1.5">
          {(Object.keys(GENDER) as Gender[]).map((g) => (
            <Button key={g} type="button" variant={chip(f.gender === g)} onClick={() => set("gender", f.gender === g ? "" : g)}>{GENDER[g]}</Button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-sm font-semibold mb-1">الحركة</p>
        <div className="grid grid-cols-4 gap-1.5">
          {MOVEMENTS.map((m) => (
            <Button key={m} type="button" size="sm" variant={chip(f.movement === m)} onClick={() => set("movement", f.movement === m ? "" : m)}>{m}</Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm font-semibold">السعر (د.ل)
          <Input inputMode="decimal" value={f.price} onChange={(e) => set("price", normalizeDecimalInput(e.target.value))} className="h-12 text-lg mt-1" />
        </label>
        <label className="text-sm font-semibold">سعر التخفيض
          <Input inputMode="decimal" value={f.promo_price} onChange={(e) => set("promo_price", normalizeDecimalInput(e.target.value))} placeholder="اختياري" className="h-12 text-lg mt-1" />
        </label>
        <label className="text-sm font-semibold">اللون
          <Input value={f.color} onChange={(e) => set("color", e.target.value)} placeholder="اختياري" className="h-12 text-base mt-1" />
        </label>
        <label className="text-sm font-semibold">العدد
          <Input inputMode="numeric" value={f.quantity} onChange={(e) => set("quantity", normalizeDecimalInput(e.target.value).split(".")[0])} className="h-12 text-lg mt-1" />
        </label>
      </div>

      <div>
        <p className="text-sm font-semibold mb-1">الفرع *</p>
        <div className="flex flex-wrap gap-1.5">
          {branches.map((b) => (
            <Button key={b.id} type="button" size="sm" variant={chip(f.branch_id === b.id)} onClick={() => set("branch_id", b.id)}>{b.name}</Button>
          ))}
        </div>
      </div>
      <label className="block text-sm font-semibold">ملاحظات
        <Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="الضمان، العلبة، الحالة…" className="mt-1" />
      </label>

      <Button size="lg" className="w-full h-12 text-base" disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? <Loader2 className="size-5 animate-spin" /> : w ? "حفظ التعديل" : "إضافة الساعة"}
      </Button>
    </div>
  );
}
