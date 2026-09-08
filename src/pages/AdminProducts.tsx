// صفحة إدارة القطع للمدير العام: جدول شامل مع تحديد متعدد لتعديل عدة حقول أو الحذف
// دفعة واحدة — بخلاف صفحة البحث العادية التي تدعم تعديل الحالة/الفرع فقط، هذه الصفحة
// تسمح بتعديل الفئة والعيار ولون المعدن والنوع دفعة واحدة، ومخصّصة للمدير العام فقط.
import { useMemo, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PRODUCT_STATUS, KARAT_OPTIONS, ProductStatus, formatWeight, getImageUrl } from "@/lib/constants";
import { GOLD_COLORS } from "@/lib/luxury";
import { Loader2, Search as SearchIcon, Pencil, Trash2, ImageOff } from "lucide-react";
import { toast } from "sonner";

const PAGE_SIZE = 100;
const NO_CHANGE = "__no_change__";

interface Row {
  id: string;
  name: string;
  sku: string | null;
  karat: string | null;
  gold_color: string | null;
  item_type: string | null;
  weight_grams: number | null;
  status: ProductStatus;
  branch_id: string | null;
  category_id: string | null;
  branch: { name: string } | null;
  category: { name: string } | null;
  images: { storage_path: string; is_primary: boolean }[];
}

export default function AdminProducts() {
  const { roles, loading, rolesLoading } = useAuth();
  const isAdmin = roles.includes("admin");
  const queryClient = useQueryClient();

  const [q, setQ] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [pages, setPages] = useState(1);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  // حقول التعديل الجماعي — "بدون تغيير" هو الافتراضي فلا نكتب فوق حقل لم يقصد المدير تغييره
  const [editCategory, setEditCategory] = useState(NO_CHANGE);
  const [editKarat, setEditKarat] = useState(NO_CHANGE);
  const [editGoldColor, setEditGoldColor] = useState(NO_CHANGE);
  const [editStatus, setEditStatus] = useState(NO_CHANGE);
  const [editBranch, setEditBranch] = useState(NO_CHANGE);
  const [editItemType, setEditItemType] = useState("");

  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => (await supabase.from("branches").select("id,name").order("name")).data ?? [],
  });
  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await supabase.from("categories").select("id,name").order("sort_order")).data ?? [],
  });

  const { data: products, isLoading, isFetching } = useQuery({
    queryKey: ["admin-products", q, branchFilter, categoryFilter, statusFilter, pages],
    queryFn: async () => {
      let query = supabase
        .from("products")
        .select(
          "id,name,sku,karat,gold_color,item_type,weight_grams,status,branch_id,category_id,branch:branches(name),category:categories(name),images:product_images(storage_path,is_primary)",
        )
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE * pages);
      const term = q.trim();
      if (term) query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%,barcode_value.ilike.%${term}%`);
      if (branchFilter !== "all") query = query.eq("branch_id", branchFilter);
      if (categoryFilter !== "all") query = query.eq("category_id", categoryFilter);
      if (statusFilter !== "all") query = query.eq("status", statusFilter as ProductStatus);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
    enabled: isAdmin,
  });

  const allSelected = !!products?.length && products.every((p) => selectedIds.has(p.id));
  const toggleAll = () => {
    if (!products) return;
    setSelectedIds((prev) => {
      if (allSelected) return new Set();
      const next = new Set(prev);
      products.forEach((p) => next.add(p.id));
      return next;
    });
  };
  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-products"] });

  const openEditDialog = () => {
    setEditCategory(NO_CHANGE);
    setEditKarat(NO_CHANGE);
    setEditGoldColor(NO_CHANGE);
    setEditStatus(NO_CHANGE);
    setEditBranch(NO_CHANGE);
    setEditItemType("");
    setEditOpen(true);
  };

  const applyBulkEdit = async () => {
    const patch: Record<string, unknown> = {};
    if (editCategory !== NO_CHANGE) patch.category_id = editCategory;
    if (editKarat !== NO_CHANGE) patch.karat = editKarat;
    if (editGoldColor !== NO_CHANGE) patch.gold_color = editGoldColor;
    if (editStatus !== NO_CHANGE) patch.status = editStatus;
    if (editBranch !== NO_CHANGE) patch.branch_id = editBranch;
    if (editItemType.trim()) patch.item_type = editItemType.trim();

    if (!Object.keys(patch).length) {
      toast.error("لم تغيّر أي حقل");
      return;
    }
    setBusy(true);
    try {
      const ids = Array.from(selectedIds);
      const { error } = await supabase.from("products").update(patch as any).in("id", ids);
      if (error) throw error;
      toast.success(`تم تعديل ${ids.length} قطعة`);
      setEditOpen(false);
      clearSelection();
      refresh();
    } catch (e: any) {
      toast.error(e.message ?? "تعذّر التعديل الجماعي");
    } finally {
      setBusy(false);
    }
  };

  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`حذف ${selectedIds.size} قطعة نهائياً؟ لا يمكن التراجع عن هذا الإجراء.`)) return;
    setBusy(true);
    try {
      const ids = Array.from(selectedIds);
      const { error } = await supabase.from("products").delete().in("id", ids);
      if (error) throw error;
      toast.success(`تم حذف ${ids.length} قطعة`);
      clearSelection();
      refresh();
    } catch (e: any) {
      toast.error(e.message ?? "تعذّر الحذف");
    } finally {
      setBusy(false);
    }
  };

  const primaryImage = (p: Row) => p.images?.find((i) => i.is_primary) ?? p.images?.[0] ?? null;

  if (!loading && !rolesLoading && !isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4 pb-24">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-bold">إدارة القطع</h1>
        <span className="text-sm text-muted-foreground">تعديل أو حذف عدة قطع دفعة واحدة</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <SearchIcon className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPages(1); }}
            placeholder="ابحث بالاسم أو SKU أو الباركود…"
            className="pr-9"
          />
        </div>
        <Select value={branchFilter} onValueChange={(v) => { setBranchFilter(v); setPages(1); }}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الفروع</SelectItem>
            {branches?.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v); setPages(1); }}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الفئات</SelectItem>
            {categories?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPages(1); }}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            {Object.entries(PRODUCT_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {selectedIds.size > 0 && (
        <div className="sticky top-0 z-10 flex items-center gap-2 flex-wrap bg-card border rounded-lg p-3 shadow-sm">
          <span className="font-semibold text-primary">{selectedIds.size} قطعة محدّدة</span>
          <Button size="sm" onClick={openEditDialog} disabled={busy}>
            <Pencil className="size-4 ml-1" /> تعديل جماعي
          </Button>
          <Button size="sm" variant="destructive" onClick={bulkDelete} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <><Trash2 className="size-4 ml-1" /> حذف</>}
          </Button>
          <Button size="sm" variant="ghost" onClick={clearSelection} disabled={busy}>إلغاء التحديد</Button>
        </div>
      )}

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="تحديد الكل" />
              </TableHead>
              <TableHead>القطعة</TableHead>
              <TableHead>الفرع</TableHead>
              <TableHead>الفئة</TableHead>
              <TableHead>العيار</TableHead>
              <TableHead>الوزن</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {products?.map((p) => {
              const img = primaryImage(p);
              const url = img ? getImageUrl(img.storage_path) : null;
              return (
                <TableRow key={p.id} data-state={selectedIds.has(p.id) ? "selected" : undefined}>
                  <TableCell>
                    <Checkbox checked={selectedIds.has(p.id)} onCheckedChange={() => toggleOne(p.id)} aria-label="تحديد" />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="size-10 rounded bg-muted overflow-hidden flex items-center justify-center shrink-0">
                        {url ? (
                          <img src={url} alt={p.name} className="size-full object-cover" />
                        ) : (
                          <ImageOff className="size-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium truncate max-w-[180px]">{p.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{p.sku || "—"}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{p.branch?.name ?? "—"}</TableCell>
                  <TableCell className="text-sm">{p.category?.name ?? "—"}</TableCell>
                  <TableCell className="text-sm">{p.karat ?? "—"}</TableCell>
                  <TableCell className="text-sm">{formatWeight(p.weight_grams)}</TableCell>
                  <TableCell>
                    <Badge className={PRODUCT_STATUS[p.status]?.color}>{PRODUCT_STATUS[p.status]?.label ?? p.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" asChild>
                      <Link to={`/products/${p.id}/edit`}><Pencil className="size-4" /></Link>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {!isLoading && products?.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                  لا توجد قطع مطابقة
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {isLoading && (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {products && products.length >= PAGE_SIZE * pages && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setPages((n) => n + 1)} disabled={isFetching}>
            {isFetching ? <Loader2 className="size-4 animate-spin" /> : "تحميل المزيد"}
          </Button>
        </div>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تعديل جماعي لـ {selectedIds.size} قطعة</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">اترك أي حقل على "بدون تغيير" ليبقى كما هو لكل قطعة.</p>
            <div className="space-y-1">
              <Label>الفئة</Label>
              <Select value={editCategory} onValueChange={setEditCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CHANGE}>بدون تغيير</SelectItem>
                  {categories?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>العيار</Label>
              <Select value={editKarat} onValueChange={setEditKarat}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CHANGE}>بدون تغيير</SelectItem>
                  {KARAT_OPTIONS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>لون المعدن</Label>
              <Select value={editGoldColor} onValueChange={setEditGoldColor}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CHANGE}>بدون تغيير</SelectItem>
                  {GOLD_COLORS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>الحالة</Label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CHANGE}>بدون تغيير</SelectItem>
                  {Object.entries(PRODUCT_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>الفرع</Label>
              <Select value={editBranch} onValueChange={setEditBranch}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CHANGE}>بدون تغيير</SelectItem>
                  {branches?.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>نوع القطعة (اختياري — يُطبَّق فقط إن كُتب)</Label>
              <Input value={editItemType} onChange={(e) => setEditItemType(e.target.value)} placeholder="مثلاً: خاتم" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={busy}>إلغاء</Button>
            <Button onClick={applyBulkEdit} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : "تطبيق"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
