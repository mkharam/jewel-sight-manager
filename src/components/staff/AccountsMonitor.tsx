// مراقبة الحسابات (للمدير العام): وين حسابك مفتوح وزر يطلّعه من كل الأجهزة، ولكل موظف — آخر مرة دخل،
// كم يوم دخل، من أي أجهزة، باع ولا لا، وعلامات تنبيه: ما يدخلش، يدخل وما يبيعش، ولا حسابه ينفتح من
// أكثر من جهاز وشبكة في نفس اليوم (يمكن عاطيه لحد).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Laptop, Loader2, LogOut, ShieldCheck, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useConfirm } from "@/components/ConfirmDialogProvider";
import { useAuth } from "@/hooks/useAuth";
import { sb, formatGrams, formatTripoli } from "@/lib/amarsoft";
import { deviceLabel } from "@/lib/presence";

type Account = {
  user_id: string; email: string; full_name: string | null; role: string | null; branch_name: string | null;
  created_at: string; last_sign_in_at: string | null; last_seen: string | null;
  active_days: number; devices: string | null; device_count: number; ip_count: number; open_sessions: number;
  shared_days: number; app_sales: number; app_added: number; pos_invoices: number; pos_grams: number;
};
type SessionRow = {
  session_id: string; user_id: string; email: string; full_name: string | null; user_agent: string | null; ip: string | null;
  created_at: string; last_active: string; is_current: boolean;
};

const ROLE: Record<string, string> = { admin: "مدير عام", manager: "مدير فرع", employee: "موظف" };
const DAYS = 30;

const daysAgo = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null);
function ago(iso: string | null) {
  if (!iso) return "ما دخلش أبداً";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 10) return "توا";
  if (m < 60) return `من ${m} دقيقة`;
  if (m < 24 * 60) return `من ${Math.floor(m / 60)} ساعة`;
  const d = Math.floor(m / 1440);
  return d === 1 ? "أمس" : `من ${d} يوم`;
}
const lastSeen = (a: Account) => {
  const xs = [a.last_seen, a.last_sign_in_at].filter(Boolean) as string[];
  return xs.length ? xs.sort().at(-1)! : null;
};
const userName = (a: { full_name: string | null; email: string }) => a.full_name || a.email.replace(/@lamaa\.(local|com)$/, "");

/** تنبيهات الحساب: كل واحدة جملة قصيرة ولون. */
function flags(a: Account): { text: string; tone: "red" | "amber" }[] {
  const out: { text: string; tone: "red" | "amber" }[] = [];
  const seen = daysAgo(lastSeen(a));
  if (!a.role) out.push({ text: "حساب بدون دور — احذفه ولا طلّعه من أجهزته", tone: "red" });
  if (Number(a.shared_days) > 0) out.push({ text: `انفتح من جهازين وشبكتين في نفس اليوم (${a.shared_days} يوم) — يمكن عاطي حسابه لحد`, tone: "red" });
  if (Number(a.open_sessions) >= 3) out.push({ text: `مفتوح في ${a.open_sessions} أجهزة`, tone: "amber" });
  if (seen == null) out.push({ text: "ما دخلش للتطبيق أبداً", tone: "amber" });
  else if (seen > 7) out.push({ text: `ما دخلش من ${seen} يوم`, tone: "amber" });
  const did = Number(a.app_sales) + Number(a.app_added) + Number(a.pos_invoices);
  if (a.role && a.role !== "admin" && seen != null && seen <= DAYS && did === 0)
    out.push({ text: "يدخل لكن ما باع ولا ضاف شي في آخر 30 يوم", tone: "amber" });
  return out;
}

export default function AccountsMonitor() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);

  const accounts = useQuery({
    queryKey: ["admin-account-activity"],
    queryFn: async () => {
      const { data, error } = await sb.rpc("admin_account_activity", { p_days: DAYS });
      if (error) throw error;
      return (data ?? []) as Account[];
    },
  });
  const sessions = useQuery({
    queryKey: ["admin-user-sessions"],
    queryFn: async () => {
      const { data, error } = await sb.rpc("admin_user_sessions", { p_user: null });
      if (error) throw error;
      return (data ?? []) as SessionRow[];
    },
  });

  const revoke = async (userId: string, sessionId: string | null, label: string) => {
    const ok = await confirm({
      title: label,
      description: "الجهاز يطلع من الحساب ويحتاج كلمة المرور باش يدخل من جديد (خلال ساعة على الأكثر). لو تشك إن حد عارف كلمة المرور، غيّرها كمان.",
      confirmLabel: "طلّع",
      destructive: true,
    });
    if (!ok) return;
    const { data, error } = await sb.rpc("admin_revoke_sessions", { p_user: userId, p_session: sessionId, p_keep_current: true });
    if (error) { toast.error(error.message); return; }
    toast.success(Number(data) ? `طلع من ${data} جهاز` : "ما فيش أجهزة ثانية");
    qc.invalidateQueries({ queryKey: ["admin-user-sessions"] });
    qc.invalidateQueries({ queryKey: ["admin-account-activity"] });
  };

  if (accounts.isLoading || sessions.isLoading) return <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-primary" /></div>;
  if (accounts.error) return <Card className="p-4 text-sm text-destructive">{(accounts.error as Error).message}</Card>;

  const all = sessions.data ?? [];
  const mine = all.filter((s) => s.user_id === user?.id);
  const list = [...(accounts.data ?? [])].sort((a, b) => flags(b).length - flags(a).length || (lastSeen(b) ?? "").localeCompare(lastSeen(a) ?? ""));
  const open = list.find((a) => a.user_id === openId) ?? null;

  return (
    <div className="space-y-3">
      {/* حسابك */}
      <Card className="p-3 border-primary/40 space-y-2">
        <h3 className="font-bold flex items-center gap-1.5"><ShieldCheck className="size-4 text-primary" />حسابك مفتوح في {mine.length} {mine.length === 1 ? "جهاز" : "أجهزة"}</h3>
        <SessionList rows={mine} onRevoke={(s) => revoke(s.user_id, s.session_id, `تطلّع حسابك من ${deviceLabel(s.user_agent)}؟`)} />
        {mine.length > 1 && (
          <Button variant="destructive" className="w-full gap-1" onClick={() => revoke(user!.id, null, "تطلّع حسابك من كل الأجهزة الثانية؟")}>
            <LogOut className="size-4" />طلّع حسابي من كل الأجهزة إلا هذا
          </Button>
        )}
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          «حفظ كلمة المرور» في المتصفح ما يوصلناش — المتصفح يحفظها عنده وما يقول لحد. اللي نقدروا نشوفوه: كل جهاز
          الحساب مفتوح فيه. لو طلّعت جهاز وكانت كلمة المرور محفوظة فيه، يقدر يدخل من جديد — فبعد ما تطلّع الأجهزة
          غيّر كلمة المرور من «الحسابات» باش ما يرجعش حد.
        </p>
      </Card>

      <p className="text-xs text-muted-foreground">
        آخر {DAYS} يوم. أيام الدخول والأجهزة بدأ تسجيلها من 8 نوفمبر 2026 — قبلها نعرفوا بس آخر دخول.
        اضغط على أي حساب للتفاصيل.
      </p>

      {list.map((a) => {
        const fl = flags(a);
        return (
          <button key={a.user_id} onClick={() => setOpenId(a.user_id)} className="w-full text-right">
            <Card className={`p-3 ${fl.some((f) => f.tone === "red") ? "border-red-500/50" : fl.length ? "border-amber-500/40" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold truncate flex items-center gap-1.5">
                    {userName(a)}
                    {a.user_id === user?.id && <Badge variant="secondary" className="text-[10px]">أنت</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">{a.role ? a.role.split(",").map((r) => ROLE[r] ?? r).join("، ") : "بدون دور"} · {a.branch_name ?? "بدون فرع"}</div>
                </div>
                <div className="text-left shrink-0">
                  <div className="text-sm font-semibold">{ago(lastSeen(a))}</div>
                  <div className="text-[11px] text-muted-foreground">{a.open_sessions} جهاز مفتوح</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground mt-1.5">
                {Number(a.active_days) > 0 && <span>دخل {a.active_days} يوم</span>}
                {Number(a.pos_invoices) > 0 && <span>أمارسوفت: {a.pos_invoices} فاتورة · {formatGrams(a.pos_grams)}</span>}
                {Number(a.app_sales) > 0 && <span>باع في التطبيق {a.app_sales}</span>}
                {Number(a.app_added) > 0 && <span>ضاف {a.app_added} قطعة</span>}
                {a.devices && <span>{a.devices}</span>}
              </div>
              {fl.map((f) => (
                <p key={f.text} className={`text-xs mt-1 flex items-center gap-1 ${f.tone === "red" ? "text-red-600" : "text-amber-700 dark:text-amber-400"}`}>
                  <AlertTriangle className="size-3.5 shrink-0" />{f.text}
                </p>
              ))}
            </Card>
          </button>
        );
      })}

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto" dir="rtl">
          {open && (
            <>
              <SheetHeader><SheetTitle>{userName(open)}</SheetTitle></SheetHeader>
              <div className="mt-2 space-y-1 text-sm">
                <p>آخر دخول: <b>{ago(lastSeen(open))}</b>{lastSeen(open) ? ` (${formatTripoli(lastSeen(open))})` : ""}</p>
                <p>آخر مرة كتب كلمة المرور: {formatTripoli(open.last_sign_in_at)}</p>
                <p>الحساب اتعمل: {formatTripoli(open.created_at)}</p>
                {Number(open.ip_count) > 0 && <p>دخل من {open.ip_count} شبكة مختلفة في آخر {DAYS} يوم</p>}
              </div>
              <h4 className="font-bold mt-3 mb-1">مفتوح في:</h4>
              <SessionList rows={all.filter((s) => s.user_id === open.user_id)}
                onRevoke={(s) => revoke(open.user_id, s.session_id, `تطلّع ${userName(open)} من ${deviceLabel(s.user_agent)}؟`)} />
              {all.some((s) => s.user_id === open.user_id && !s.is_current) && (
                <Button variant="destructive" className="w-full mt-3 gap-1"
                  onClick={() => revoke(open.user_id, null, `تطلّع ${userName(open)} من كل الأجهزة؟`)}>
                  <LogOut className="size-4" />طلّعه من كل الأجهزة
                </Button>
              )}
              {flags(open).map((f) => (
                <p key={f.text} className={`text-xs mt-2 flex items-center gap-1 ${f.tone === "red" ? "text-red-600" : "text-amber-700 dark:text-amber-400"}`}>
                  <AlertTriangle className="size-3.5 shrink-0" />{f.text}
                </p>
              ))}
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SessionList({ rows, onRevoke }: { rows: SessionRow[]; onRevoke: (s: SessionRow) => void }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">مش مفتوح في أي جهاز توا.</p>;
  return (
    <div className="divide-y">
      {rows.map((s) => {
        const label = deviceLabel(s.user_agent);
        const Icon = /آيفون|أندرويد|آيباد/.test(label) ? Smartphone : Laptop;
        return (
          <div key={s.session_id} className="flex items-center gap-2 py-2">
            <Icon className="size-5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold flex items-center gap-1.5">
                {label}{s.is_current && <Badge className="text-[10px]">هذا الجهاز</Badge>}
              </div>
              <div className="text-[11px] text-muted-foreground" dir="auto">
                آخر نشاط {ago(s.last_active)} · دخل {formatTripoli(s.created_at)}{s.ip ? ` · ${s.ip}` : ""}
              </div>
            </div>
            {!s.is_current && (
              <Button size="sm" variant="outline" className="shrink-0 text-destructive" onClick={() => onRevoke(s)}>طلّع</Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
