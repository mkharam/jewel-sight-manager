import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { attachStaffNames } from "@/lib/staffNames";
import { describe } from "@/lib/notifications";
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
import { useConfirm } from "@/components/ConfirmDialogProvider";
import { UserPlus, Trash2, KeyRound, Users, Package, Tag, ArrowLeftRight, MessageCircle, Activity, Trophy, Coins, Medal, ImagePlus, Wrench } from "lucide-react";
import { formatDate, formatCurrency, type Period, PERIOD_LABEL, periodStartISO } from "@/lib/constants";
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
  const confirm = useConfirm();
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
    const ok = await confirm({
      title: `حذف حساب ${u.full_name || u.email}؟`,
      description: "سيفقد الموظف الوصول للتطبيق نهائياً ولا يمكن التراجع.",
      confirmLabel: "حذف الحساب",
      destructive: true,
    });
    if (!ok) return;
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
        <TabsList className="w-full grid grid-cols-3">
          <TabsTrigger value="list"><Users className="size-4 ml-1" /> الحسابات</TabsTrigger>
          <TabsTrigger value="leaderboard"><Trophy className="size-4 ml-1" /> المبيعات</TabsTrigger>
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

        <TabsContent value="leaderboard" className="mt-3">
          <SalesLeaderboard />
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
            <Input type="password" dir="ltr" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="4 خانات على الأقل" autoComplete="new-password" />
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
  repairs: number;
};

function ActivityPanel({ branches }: { branches: Branch[] }) {
  const [stats, setStats] = useState<EmpStat[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [loading, setLoadingState] = useState(true);
  // الضغط على بطاقة موظف يقصر الشريط على أفعاله هو — «كل واحد شن دار».
  const [focusId, setFocusId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoadingState(true);
      const [
        { data: profs },
        { data: products },
        { data: quotes },
        { data: transfers },
        { data: inquiries },
        { data: repairRows },
      ] = await Promise.all([
        supabase.from("profiles").select("id, full_name, branch_id"),
        supabase.from("products").select("id, name, created_by, created_at, branch:branches(name)").neq("status", "archived").order("created_at", { ascending: false }).limit(50),
        supabase.from("product_quotes").select("id, price, customer_name, quoted_by, created_at, product:products(id,name)").order("created_at", { ascending: false }).limit(50),
        supabase.from("transfers").select("id, product_name_snapshot, requested_by, created_at, status, from_branch:branches!transfers_from_branch_id_fkey(name), to_branch:branches!transfers_to_branch_id_fkey(name)").order("created_at", { ascending: false }).limit(50),
        supabase.from("customer_inquiries").select("id, customer_name, created_by, created_at").order("created_at", { ascending: false }).limit(50),
        // تذاكر الصيانة (نسخة من تطبيق الصيانة، مقروءة للمدير): الموظف المستلم = received_by.
        // نجلب الأعمدة الخفيفة كلها لا آخر ٥٠ وحدها، حتى يكون العدّ مجموعاً حقيقياً.
        (supabase as any).from("repair_tickets").select("id, ticket_number, item_name, customer_name, received_by, received_at").not("received_by", "is", null).order("received_at", { ascending: false }).limit(5000),
      ]);


      const branchMap = new Map(branches.map((b) => [b.id, b.name]));
      const map = new Map<string, EmpStat>();
      (profs ?? []).forEach((p: any) => {
        map.set(p.id, {
          id: p.id, full_name: p.full_name,
          branch_name: p.branch_id ? branchMap.get(p.branch_id) ?? null : null,
          products: 0, quotes: 0, transfers: 0, inquiries: 0, repairs: 0,
        });
      });
      (repairRows ?? []).forEach((r: any) => {
        const s = map.get(r.received_by);
        if (s) s.repairs += 1;
      });

      // الأعداد من قاعدة البيانات لا من الصفوف المجلوبة أعلاه: تلك محدودة بآخر ٥٠ صفاً
      // لبناء شريط النشاط الأخير، فكان عدّها يعطي «نصيب الموظف من آخر ٥٠» لا مجموعه —
      // من أضاف ٦٢ قطعة كان يظهر بـ٥. راجع staff_activity_counts في قاعدة البيانات.
      const { data: counts, error: countsErr } = await supabase.rpc("staff_activity_counts", { p_since: null });
      if (countsErr) toast.error(countsErr.message);
      (counts ?? []).forEach((c: any) => {
        const s = map.get(c.user_id);
        if (!s) return;
        s.products = Number(c.products) || 0;
        s.quotes = Number(c.quotes) || 0;
        s.transfers = Number(c.transfers) || 0;
        s.inquiries = Number(c.inquiries) || 0;
      });

      const sorted = Array.from(map.values()).sort((a, b) =>
        (b.products + b.quotes + b.transfers + b.inquiries + b.repairs) - (a.products + a.quotes + a.transfers + a.inquiries + a.repairs)
      );
      setStats(sorted);

      // شريط النشاط من activity_log لا من الجداول الأربعة الخام: السجل يغطّي الحذف
      // والتعديل والبيع والإرجاع أيضاً — وهي بالضبط ما يحتاج المالك رؤيته الآن بعد أن
      // صار الموظف يحذف ويعدّل بضاعة فرعه. describe() هي نفسها المستعملة في الإشعارات.
      const profMap = new Map((profs ?? []).map((p: any) => [p.id, p.full_name]));
      // الاستبعاد في الاستعلام لا بعده: أرشفة دفعة الاختبار ولّدت مئات الأسطر بلا فاعل
      // تتصدّر السجل، فلو صفّيناها بعد الجلب لعاد الشريط فارغاً وخلفها نشاط حقيقي أقدم.
      const { data: log } = await supabase
        .from("activity_log")
        .select("*")
        .not("actor_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(300);

      const feed: any[] = [];
      for (const row of (log ?? []) as any[]) {
        // السؤال هنا «كل واحد شن دار» — فالأسطر بلا فاعل (عمليات دفعة على قاعدة
        // البيانات) لا تُنسب لأحد ولا محلّ لها في سجل الموظفين.
        if (!row.actor_id) continue;
        const item = { ...row, actor_name: profMap.get(row.actor_id) };
        const d = describe(item);
        if (!d) continue;
        feed.push({
          at: row.created_at,
          actorId: row.actor_id,
          who: profMap.get(row.actor_id) ?? "—",
          // describe() تبدأ النص باسم الفاعل، والاسم يُعرض منفصلاً هنا — نحذفه من النص.
          text: d.text.startsWith(`${profMap.get(row.actor_id) ?? ""} `)
            ? d.text.slice((profMap.get(row.actor_id) ?? "").length + 1)
            : d.text,
          link: d.href,
          icon: d.icon,
        });
      }
      // الصيانة ليست في activity_log (تُكتب في قاعدة تطبيق آخر) فندمجها في الشريط بزمنها.
      for (const r of (repairRows ?? []).slice(0, 100) as any[]) {
        feed.push({
          at: r.received_at,
          actorId: r.received_by,
          who: profMap.get(r.received_by) ?? "—",
          text: `استلم تذكرة صيانة ${r.ticket_number} — ${r.item_name}${r.customer_name ? ` (${r.customer_name})` : ""}`,
          link: "/admin/repairs",
          icon: Wrench,
        });
      }
      feed.sort((a, b) => (a.at < b.at ? 1 : -1));
      setRecent(feed);
      setLoadingState(false);
    })();
  }, [branches]);

  if (loading) return <div className="text-center py-8 text-muted-foreground">جارٍ التحميل...</div>;

  const focusName = focusId ? stats.find((s) => s.id === focusId)?.full_name ?? null : null;
  const shown = (focusId ? recent.filter((r: any) => r.actorId === focusId) : recent).slice(0, 40);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">اضغط على أي موظف لعرض ما قام به وحده.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {stats.map((s) => {
          const total = s.products + s.quotes + s.transfers + s.inquiries + s.repairs;
          return (
            <Card
              key={s.id}
              onClick={() => setFocusId((cur) => (cur === s.id ? null : s.id))}
              className={`p-3 cursor-pointer transition-colors ${
                focusId === s.id ? "ring-2 ring-primary bg-gold-soft" : "hover:bg-muted/40"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold truncate">{s.full_name}</p>
                  <p className="text-xs text-muted-foreground">{s.branch_name ?? "—"}</p>
                </div>
                <Badge variant="secondary" className="shrink-0">{total} نشاط</Badge>
              </div>
              <div className="grid grid-cols-5 gap-1 mt-3 text-center">
                <Stat icon={Package} label="قطع" value={s.products} />
                <Stat icon={Tag} label="أسعار" value={s.quotes} />
                <Stat icon={ArrowLeftRight} label="تحويلات" value={s.transfers} />
                <Stat icon={MessageCircle} label="استفسارات" value={s.inquiries} />
                <Stat icon={Wrench} label="صيانة" value={s.repairs} />
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="p-3">
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <h3 className="font-bold flex items-center gap-2">
            <Activity className="size-4 text-primary" />
            {focusName ? `نشاط ${focusName}` : "آخر النشاطات"}
          </h3>
          {focusId && (
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setFocusId(null)}>
              عرض الجميع
            </Button>
          )}
        </div>
        <div className="divide-y divide-border">
          {shown.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              {focusName ? `لا نشاط مسجّل لـ${focusName}` : "لا توجد نشاطات بعد"}
            </p>
          )}
          {shown.map((r: any, i: number) => {
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

type SellerStat = {
  id: string;
  full_name: string;
  count: number;   // قطع مباعة
  total: number;   // قيمة المبيعات
  added: number;   // قطع أضافها للمخزون
};

/** أداء الموظفين — المبيعات من جدول sales مباشرة (sold_by/final_price/sold_at) لا تخميناً
 * من حالة القطعة، والمرتجعات (returned_at) مستبعدة مطابقةً لمنطق Reports.tsx. ويُضاف
 * إليها عدد القطع التي أدخلها كل موظف للمخزون (products.created_by): تصوير البضاعة
 * وإدخالها شغل حقيقي لم يكن يظهر في أي مكان، فموظف يصوّر مئة قطعة ولا يبيع كان يبدو
 * كأنه لم يفعل شيئاً. لذلك تُبنى القائمة من المصدرين معاً لا من المبيعات وحدها. */
function SalesLeaderboard() {
  const [period, setPeriod] = useState<Period>("month");

  // ضمن الكاش المشترك: أي بيع يُسجَّل في التطبيق يُبطل ["sales-leaderboard"] فتتحدّث
  // اللوحة فوراً بلا إعادة تحميل. keepPreviousData يُبقي الترتيب ظاهراً أثناء تبديل
  // الفترة بدل إفراغ القائمة وإظهار "جارٍ التحميل" في كل ضغطة.
  const { data: stats } = useQuery({
    queryKey: ["sales-leaderboard", period],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<SellerStat[]> => {
      const since = periodStartISO(period);
      const [salesRes, addedRes] = await Promise.all([
        supabase
          .from("sales")
          .select("sold_by, final_price")
          .gte("sold_at", since)
          .is("returned_at", null),
        // القطع المؤرشفة مستبعدة كي لا تُحسب دفعات الاختبار ضمن إنتاج أحد.
        supabase
          .from("products")
          .select("created_by")
          .gte("created_at", since)
          .neq("status", "archived"),
      ]);
      if (salesRes.error) { toast.error(salesRes.error.message); throw salesRes.error; }
      if (addedRes.error) { toast.error(addedRes.error.message); throw addedRes.error; }

      const map = new Map<string, SellerStat>();
      const bucket = (id: string) => {
        let cur = map.get(id);
        if (!cur) { cur = { id, full_name: "—", count: 0, total: 0, added: 0 }; map.set(id, cur); }
        return cur;
      };

      for (const r of (salesRes.data ?? []) as any[]) {
        if (!r.sold_by) continue;
        const cur = bucket(r.sold_by);
        cur.count += 1;
        cur.total += Number(r.final_price) || 0;
      }
      for (const r of (addedRes.data ?? []) as any[]) {
        if (!r.created_by) continue;
        bucket(r.created_by).added += 1;
      }

      const rows = Array.from(map.values());
      await attachStaffNames(rows, "id", "staff");
      for (const r of rows) r.full_name = (r as any).staff?.full_name ?? "—";

      // الترتيب بقيمة المبيعات أولاً (هي المسابقة)، ومن لا مبيعات له يُرتَّب بعدد ما أضاف.
      return rows.sort((a, b) => b.total - a.total || b.added - a.added);
    },
  });

  const medalCls = ["bg-gold-gradient text-primary-foreground", "bg-slate-300 text-slate-900", "bg-amber-700 text-white"];

  return (
    <div className="space-y-3">
      <div className="flex rounded-lg border overflow-hidden w-fit">
        {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-3 h-9 text-xs font-semibold transition-colors ${
              period === p ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground"
            }`}
          >
            {PERIOD_LABEL[p]}
          </button>
        ))}
      </div>

      {!stats ? (
        <div className="text-center py-8 text-muted-foreground">جارٍ التحميل...</div>
      ) : stats.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">لا توجد مبيعات في هذه الفترة</Card>
      ) : (
        <div className="space-y-2">
          {stats.map((s, i) => (
            <Card key={s.id} className="p-3 flex items-center gap-3">
              <div
                className={`size-9 rounded-full flex items-center justify-center shrink-0 font-bold text-sm ${
                  i < 3 ? medalCls[i] : "bg-muted text-muted-foreground"
                }`}
              >
                {i < 3 ? <Medal className="size-4" /> : i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold truncate">{s.full_name}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                  <span className="flex items-center gap-1"><Package className="size-3" /> {s.count} قطعة مباعة</span>
                  {s.added > 0 && (
                    <span className="flex items-center gap-1"><ImagePlus className="size-3" /> {s.added} قطعة أضافها</span>
                  )}
                </p>
              </div>
              <div className="text-left shrink-0">
                <p className="font-bold text-primary flex items-center gap-1 justify-end">
                  <Coins className="size-3.5" /> {formatCurrency(s.total)}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
