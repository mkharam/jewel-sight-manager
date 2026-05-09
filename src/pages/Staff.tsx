import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { UserPlus, Trash2, KeyRound, Users, Package, Tag, ArrowLeftRight, MessageCircle, Activity } from "lucide-react";
import { formatDate } from "@/lib/constants";
import { Link } from "react-router-dom";

type Branch = { id: string; name: string };
type StaffUser = {
  id: string;
  email: string;
  full_name: string;
  role: "admin" | "manager" | "employee";
  branch_id: string | null;
  created_at: string;
};

const ROLE_LABEL = { admin: "مدير عام", manager: "مدير فرع", employee: "موظف" } as const;

export default function Staff() {
  const { user, roles, loading, rolesLoading } = useAuth();
  const isAdmin = roles.includes("admin");

  const [users, setUsers] = useState<StaffUser[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [busy, setBusy] = useState(false);
  const [openNew, setOpenNew] = useState(false);
  const [pwUser, setPwUser] = useState<StaffUser | null>(null);

  // form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"admin" | "manager" | "employee">("employee");
  const [branchId, setBranchId] = useState<string>("none");
  const [newPw, setNewPw] = useState("");

  const load = async () => {
    setBusy(true);
    try {
      const [{ data: br }, fn] = await Promise.all([
        supabase.from("branches").select("id, name").order("name"),
        supabase.functions.invoke("admin-manage-users", { body: { action: "list" } }),
      ]);
      setBranches(br ?? []);
      if (fn.error) throw new Error(fn.error.message);
      const data = fn.data as { users: StaffUser[]; error?: string };
      if (data.error) throw new Error(data.error);
      setUsers(data.users ?? []);
    } catch (e: any) {
      toast.error(e.message ?? "تعذر تحميل البيانات");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!loading && !rolesLoading && isAdmin) load();
  }, [loading, rolesLoading, isAdmin]);

  if (loading || rolesLoading) {
    return <div className="text-center py-12 text-muted-foreground">جارٍ التحميل...</div>;
  }
  if (!isAdmin) return <Navigate to="/" replace />;

  const resetForm = () => {
    setEmail(""); setPassword(""); setFullName(""); setRole("employee"); setBranchId("none");
  };

  const createUser = async () => {
    if (!email || !password || !fullName) { toast.error("املأ كل الحقول"); return; }
    if (password.length < 4) { toast.error("كلمة المرور 4 خانات على الأقل"); return; }
    if (!/^[a-zA-Z0-9._-]+$/.test(email.trim())) {
      toast.error("اسم المستخدم: أحرف إنجليزية وأرقام فقط"); return;
    }
    const fullEmail = email.trim().toLowerCase().includes("@")
      ? email.trim().toLowerCase()
      : `${email.trim().toLowerCase()}@lamaa.local`;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("admin-manage-users", {
      body: { action: "create", email: fullEmail, password, full_name: fullName, role, branch_id: branchId === "none" ? null : branchId },
    });
    setBusy(false);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error ?? error?.message ?? "فشل إنشاء الحساب");
      return;
    }
    toast.success("تم إنشاء الحساب");
    setOpenNew(false); resetForm(); load();
  };

  const changeRole = async (u: StaffUser, newRole: "admin" | "manager" | "employee") => {
    if (u.id === user?.id && newRole !== "admin") {
      toast.error("لا يمكنك تخفيض صلاحياتك");
      return;
    }
    const { error: dErr } = await supabase.from("user_roles").delete().eq("user_id", u.id);
    if (dErr) { toast.error(dErr.message); return; }
    const { error } = await supabase.from("user_roles").insert({ user_id: u.id, role: newRole });
    if (error) { toast.error(error.message); return; }
    toast.success("تم تعديل الدور");
    load();
  };

  const changeBranch = async (u: StaffUser, newBranch: string) => {
    const value = newBranch === "none" ? null : newBranch;
    const { error } = await supabase.from("profiles").update({ branch_id: value }).eq("id", u.id);
    if (error) { toast.error(error.message); return; }
    toast.success("تم تعديل الفرع");
    load();
  };

  const deleteUser = async (u: StaffUser) => {
    if (u.id === user?.id) { toast.error("لا يمكنك حذف حسابك"); return; }
    if (!confirm(`حذف الحساب ${u.email} نهائياً؟`)) return;
    const { data, error } = await supabase.functions.invoke("admin-manage-users", {
      body: { action: "delete", user_id: u.id },
    });
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error ?? error?.message ?? "فشل الحذف"); return;
    }
    toast.success("تم الحذف");
    load();
  };

  const resetPassword = async () => {
    if (!pwUser || !newPw || newPw.length < 4) { toast.error("كلمة مرور غير صالحة"); return; }
    const { data, error } = await supabase.functions.invoke("admin-manage-users", {
      body: { action: "update_password", user_id: pwUser.id, password: newPw },
    });
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error ?? error?.message ?? "فشل التعديل"); return;
    }
    toast.success("تم تغيير كلمة المرور");
    setPwUser(null); setNewPw("");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="size-5 text-primary" />
          <h1 className="text-xl font-bold">إدارة الموظفين</h1>
        </div>
        <Dialog open={openNew} onOpenChange={(o) => { setOpenNew(o); if (!o) resetForm(); }}>
          <DialogTrigger asChild>
            <Button className="bg-gold-gradient text-primary-foreground shadow-gold">
              <UserPlus className="size-4 ml-1" /> موظف جديد
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>إنشاء حساب موظف</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>الاسم الكامل</Label>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>اسم المستخدم</Label>
                <Input dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="مثال: ahmed" />
                <p className="text-[11px] text-muted-foreground">يستخدمه الموظف لتسجيل الدخول (إنجليزي/أرقام فقط)</p>
              </div>
              <div className="space-y-1.5">
                <Label>كلمة المرور</Label>
                <Input type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="4 خانات على الأقل" autoComplete="new-password" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>الدور</Label>
                  <Select value={role} onValueChange={(v: any) => setRole(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="employee">موظف</SelectItem>
                      <SelectItem value="manager">مدير فرع</SelectItem>
                      <SelectItem value="admin">مدير عام</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>الفرع</Label>
                  <Select value={branchId} onValueChange={setBranchId}>
                    <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— بدون —</SelectItem>
                      {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpenNew(false)}>إلغاء</Button>
              <Button onClick={createUser} disabled={busy} className="bg-gold-gradient text-primary-foreground">إنشاء</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="list" className="w-full">
        <TabsList className="w-full grid grid-cols-2">
          <TabsTrigger value="list"><Users className="size-4 ml-1" /> الحسابات</TabsTrigger>
          <TabsTrigger value="activity"><Activity className="size-4 ml-1" /> نشاط الموظفين</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-3">
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">الاسم</TableHead>
                  <TableHead className="text-right">اسم المستخدم</TableHead>
                  <TableHead className="text-right">الدور</TableHead>
                  <TableHead className="text-right">الفرع</TableHead>
                  <TableHead className="text-right">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    {busy ? "جارٍ التحميل..." : "لا يوجد موظفون"}
                  </TableCell></TableRow>
                )}
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      {u.full_name || "—"}
                      {u.id === user?.id && <Badge variant="secondary" className="mr-2">أنت</Badge>}
                    </TableCell>
                    <TableCell dir="ltr" className="text-sm">{u.email.replace(/@lamaa\.(local|com)$/, "")}</TableCell>
                    <TableCell>
                      <Select value={u.role} onValueChange={(v: any) => changeRole(u, v)} disabled={u.id === user?.id}>
                        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="employee">{ROLE_LABEL.employee}</SelectItem>
                          <SelectItem value="manager">{ROLE_LABEL.manager}</SelectItem>
                          <SelectItem value="admin">{ROLE_LABEL.admin}</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select value={u.branch_id ?? "none"} onValueChange={(v) => changeBranch(u, v)}>
                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— بدون —</SelectItem>
                          {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => { setPwUser(u); setNewPw(""); }} title="تغيير كلمة المرور">
                          <KeyRound className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => deleteUser(u)} disabled={u.id === user?.id} title="حذف" className="text-destructive">
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="mt-3">
          <ActivityPanel branches={branches} />
        </TabsContent>
      </Tabs>

      <Dialog open={!!pwUser} onOpenChange={(o) => !o && setPwUser(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>تغيير كلمة مرور — {pwUser?.full_name}</DialogTitle></DialogHeader>
          <div className="space-y-1.5">
            <Label>كلمة المرور الجديدة</Label>
            <Input type="text" dir="ltr" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="4 خانات على الأقل" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwUser(null)}>إلغاء</Button>
            <Button onClick={resetPassword} className="bg-gold-gradient text-primary-foreground">حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type EmpStat = {
  id: string;
  full_name: string;
  branch_name: string | null;
  products: number;
  quotes: number;
  transfers: number;
  inquiries: number;
};

function ActivityPanel({ branches }: { branches: Branch[] }) {
  const [stats, setStats] = useState<EmpStat[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [loading, setLoadingState] = useState(true);

  useEffect(() => {
    (async () => {
      setLoadingState(true);
      const [
        { data: profs },
        { data: products },
        { data: quotes },
        { data: transfers },
        { data: inquiries },
      ] = await Promise.all([
        supabase.from("profiles").select("id, full_name, branch_id"),
        supabase.from("products").select("id, name, created_by, created_at, branch:branches(name)").order("created_at", { ascending: false }).limit(50),
        supabase.from("product_quotes").select("id, price, customer_name, quoted_by, created_at, product:products(id,name)").order("created_at", { ascending: false }).limit(50),
        supabase.from("transfers").select("id, product_name_snapshot, requested_by, created_at, status, from_branch:branches!transfers_from_branch_id_fkey(name), to_branch:branches!transfers_to_branch_id_fkey(name)").order("created_at", { ascending: false }).limit(50),
        supabase.from("customer_inquiries").select("id, customer_name, created_by, created_at").order("created_at", { ascending: false }).limit(50),
      ]);


      const branchMap = new Map(branches.map((b) => [b.id, b.name]));
      const map = new Map<string, EmpStat>();
      (profs ?? []).forEach((p: any) => {
        map.set(p.id, {
          id: p.id, full_name: p.full_name,
          branch_name: p.branch_id ? branchMap.get(p.branch_id) ?? null : null,
          products: 0, quotes: 0, transfers: 0, inquiries: 0,
        });
      });
      (products ?? []).forEach((r: any) => { const s = map.get(r.created_by); if (s) s.products++; });
      (quotes ?? []).forEach((r: any) => { const s = map.get(r.quoted_by); if (s) s.quotes++; });
      (transfers ?? []).forEach((r: any) => { const s = map.get(r.requested_by); if (s) s.transfers++; });
      (inquiries ?? []).forEach((r: any) => { const s = map.get(r.created_by); if (s) s.inquiries++; });

      const sorted = Array.from(map.values()).sort((a, b) =>
        (b.products + b.quotes + b.transfers + b.inquiries) - (a.products + a.quotes + a.transfers + a.inquiries)
      );
      setStats(sorted);

      // Build a recent activity feed combining the four sources
      const profMap = new Map((profs ?? []).map((p: any) => [p.id, p.full_name]));
      const feed: any[] = [];
      (products ?? []).slice(0, 20).forEach((r: any) => feed.push({
        kind: "product", at: r.created_at, who: profMap.get(r.created_by) ?? "—",
        text: `أضاف قطعة جديدة: ${r.name}`, link: `/products/${r.id}`, icon: Package,
      }));
      (quotes ?? []).slice(0, 20).forEach((r: any) => feed.push({
        kind: "quote", at: r.created_at, who: profMap.get(r.quoted_by) ?? "—",
        text: `سجّل سعر ${r.price} د.ل لـ ${r.product?.name ?? "قطعة"}${r.customer_name ? ` (${r.customer_name})` : ""}`,
        link: r.product?.id ? `/products/${r.product.id}` : null, icon: Tag,
      }));
      (transfers ?? []).slice(0, 20).forEach((r: any) => feed.push({
        kind: "transfer", at: r.created_at, who: profMap.get(r.requested_by) ?? "—",
        text: `طلب تحويل ${r.product_name_snapshot ?? "قطعة"} من ${r.from_branch?.name} إلى ${r.to_branch?.name}`,
        link: `/transfers`, icon: ArrowLeftRight,
      }));
      (inquiries ?? []).slice(0, 20).forEach((r: any) => feed.push({
        kind: "inquiry", at: r.created_at, who: profMap.get(r.created_by) ?? "—",
        text: `سجّل استفسار من ${r.customer_name ?? "عميل"}`,
        link: `/inquiries`, icon: MessageCircle,
      }));
      feed.sort((a, b) => +new Date(b.at) - +new Date(a.at));
      setRecent(feed.slice(0, 30));
      setLoadingState(false);
    })();
  }, [branches]);

  if (loading) return <div className="text-center py-8 text-muted-foreground">جارٍ التحميل...</div>;

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        {stats.map((s) => {
          const total = s.products + s.quotes + s.transfers + s.inquiries;
          return (
            <Card key={s.id} className="p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold truncate">{s.full_name}</p>
                  <p className="text-xs text-muted-foreground">{s.branch_name ?? "—"}</p>
                </div>
                <Badge variant="secondary" className="shrink-0">{total} نشاط</Badge>
              </div>
              <div className="grid grid-cols-4 gap-1 mt-3 text-center">
                <Stat icon={Package} label="قطع" value={s.products} />
                <Stat icon={Tag} label="أسعار" value={s.quotes} />
                <Stat icon={ArrowLeftRight} label="تحويلات" value={s.transfers} />
                <Stat icon={MessageCircle} label="استفسارات" value={s.inquiries} />
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="p-3">
        <h3 className="font-bold mb-2 flex items-center gap-2"><Activity className="size-4 text-primary" /> آخر النشاطات</h3>
        <div className="divide-y divide-border">
          {recent.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">لا توجد نشاطات بعد</p>}
          {recent.map((r, i) => {
            const Icon = r.icon;
            const Inner = (
              <div className="flex items-start gap-2 py-2">
                <div className="size-8 rounded-full bg-gold-soft flex items-center justify-center shrink-0">
                  <Icon className="size-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm"><span className="font-semibold">{r.who}</span> {r.text}</p>
                  <p className="text-[11px] text-muted-foreground">{formatDate(r.at)}</p>
                </div>
              </div>
            );
            return r.link ? (
              <Link to={r.link} key={i} className="block hover:bg-muted/40 rounded px-1">{Inner}</Link>
            ) : <div key={i} className="px-1">{Inner}</div>;
          })}
        </div>
      </Card>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted/40 p-1.5">
      <Icon className="size-3.5 mx-auto text-muted-foreground" />
      <p className="text-base font-bold leading-tight mt-0.5">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
