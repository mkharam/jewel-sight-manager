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
import { toast } from "sonner";
import { UserPlus, Trash2, KeyRound, Users } from "lucide-react";

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
                <Input type="text" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="4 خانات على الأقل" />
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

      <Card className="overflow-hidden">
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
