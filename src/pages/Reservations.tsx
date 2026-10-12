// الحجوزات — كل حجز فعّال مرتّباً بتاريخ انتهائه، مع تنبيه ما ينتهي اليوم/غداً أو تأخّر.
//
// كانت الحجوزات بلا شاشة إلا داخل صفحة القطعة، ودالة الانتهاء لا يستدعيها أحد فبقيت القطع
// «محجوزة» إلى الأبد. الآن يُنهي مهمّة يومية الحجز بعد مهلة يومين من تاريخه، وهذه الصفحة
// تُتيح التمديد أو الإلغاء أو تذكير الزبون قبل ذلك. الإلغاء والانتهاء يعيدان القطعة
// «متوفرة» عبر trigger قاعدة البيانات نفسه.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { businessToday, daysBetween } from "@/lib/dates";
import { whatsappLink } from "@/lib/whatsapp";
import { formatCurrency } from "@/lib/constants";
import { invalidateInventoryAndSales } from "@/lib/queryInvalidation";
import { useConfirm } from "@/components/ConfirmDialogProvider";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookmarkCheck, MessageCircle, CalendarPlus, XCircle } from "lucide-react";
import { toast } from "sonner";

interface Reservation {
  id: string;
  product_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  deposit: number;
  agreed_price: number | null;
  expires_at: string;
  status: "active" | "expired" | "cancelled" | "converted";
  branch_id: string | null;
  notes: string | null;
  product?: { id: string; name: string; sku: string | null } | null;
  branch?: { name: string } | null;
}

const GRACE_DAYS = 2; // يطابق expire_due_reservations في قاعدة البيانات

export default function Reservations() {
  const { roles, profile } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const isAdmin = roles.includes("admin");
  const [showExpired, setShowExpired] = useState(false);

  const { data = [], isLoading } = useQuery({
    queryKey: ["reservations-page"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reservations")
        .select("*, product:products(id,name,sku), branch:branches(name)")
        .in("status", ["active", "expired"])
        .order("expires_at", { ascending: true })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as unknown as Reservation[];
    },
  });

  const today = businessToday();
  // المدير العام يرى كل الفروع، وغيره فرعه (قطع فرعه هي ما يستطيع تسليمه).
  const scoped = useMemo(
    () => data.filter((r) => isAdmin || !profile?.branch_id || r.branch_id === profile.branch_id),
    [data, isAdmin, profile?.branch_id],
  );
  const active = scoped.filter((r) => r.status === "active");
  const expired = scoped.filter((r) => r.status === "expired");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["reservations-page"] });
    qc.invalidateQueries({ queryKey: ["daily-summary-reservations"] });
    invalidateInventoryAndSales(qc);
  };

  const extend = async (r: Reservation) => {
    const base = r.expires_at > today ? r.expires_at : today;
    const next = new Date(Date.parse(base + "T00:00:00Z") + 7 * 86_400_000).toISOString().slice(0, 10);
    const { error } = await supabase.from("reservations").update({ expires_at: next }).eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success(`تم التمديد إلى ${next}`);
    refresh();
  };

  const cancel = async (r: Reservation) => {
    const ok = await confirm({
      title: "إلغاء الحجز؟",
      description: `ستعود القطعة «${r.product?.name ?? ""}» متوفرة. العربون (${formatCurrency(r.deposit)}) لا يُردّ تلقائياً — رتّبه مع الزبون.`,
      confirmLabel: "إلغاء الحجز",
      destructive: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("reservations").update({ status: "cancelled" }).eq("id", r.id);
    if (error) return toast.error(error.message);
    refresh();
  };

  const label = (r: Reservation) => {
    const left = daysBetween(today, r.expires_at); // موجب = متبقٍّ
    if (r.status === "expired") return { text: "انتهى الحجز", tone: "bg-destructive/15 text-destructive border-destructive/30" };
    if (left < 0) return { text: `تأخّر ${-left} ${-left === 1 ? "يوم" : "أيام"} — يُفرَج بعد ${Math.max(GRACE_DAYS + left, 0)} ي`, tone: "bg-destructive/15 text-destructive border-destructive/30" };
    if (left === 0) return { text: "ينتهي اليوم", tone: "bg-warning/20 text-warning-foreground border-warning/40" };
    if (left === 1) return { text: "ينتهي غداً", tone: "bg-warning/20 text-warning-foreground border-warning/40" };
    return { text: `باقٍ ${left} أيام`, tone: "bg-muted text-muted-foreground border-border" };
  };

  const card = (r: Reservation) => {
    const st = label(r);
    const reminder = whatsappLink(
      r.customer_phone,
      `السلام عليكم ${r.customer_name ?? ""}، نذكّركم بأن حجز (${r.product?.name ?? "القطعة"}) ينتهي بتاريخ ${r.expires_at}. يسعدنا استلامكم لها أو التواصل معنا لتمديد الحجز.`,
    );
    return (
      <Card key={r.id} className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link to={`/products/${r.product_id}`} className="font-bold truncate block hover:underline">{r.product?.name ?? "قطعة"}</Link>
            <p className="text-xs text-muted-foreground">{r.customer_name ?? "—"}{r.customer_phone ? ` · ${r.customer_phone}` : ""}{isAdmin && r.branch?.name ? ` · ${r.branch.name}` : ""}</p>
          </div>
          <Badge variant="outline" className={`shrink-0 ${st.tone}`}>{st.text}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          عربون {formatCurrency(r.deposit)}{r.agreed_price != null ? ` · المتّفق ${formatCurrency(r.agreed_price)}` : ""} · ينتهي {r.expires_at}
        </p>
        {r.status === "active" && (
          <div className="flex gap-2 flex-wrap">
            {reminder && (
              <a href={reminder} target="_blank" rel="noreferrer">
                <Button size="sm" variant="secondary"><MessageCircle className="size-4 ml-1" />ذكّر الزبون</Button>
              </a>
            )}
            <Button size="sm" variant="outline" onClick={() => extend(r)}><CalendarPlus className="size-4 ml-1" />مدّد 7 أيام</Button>
            <Button size="sm" variant="outline" className="text-destructive" onClick={() => cancel(r)}><XCircle className="size-4 ml-1" />إلغاء</Button>
          </div>
        )}
      </Card>
    );
  };

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <header className="flex items-center gap-3">
        <div className="size-10 rounded-xl bg-gold-gradient flex items-center justify-center shadow-gold">
          <BookmarkCheck className="size-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-xl font-extrabold text-gold-gradient">الحجوزات</h1>
          <p className="text-xs text-muted-foreground">
            يُفرَج عن القطعة تلقائياً بعد {GRACE_DAYS} يومين من تاريخ انتهاء الحجز. الحجز يبدأ من صفحة القطعة.
          </p>
        </div>
      </header>

      {isLoading ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">جارٍ التحميل…</Card>
      ) : active.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">لا حجوزات فعّالة</Card>
      ) : (
        <div className="space-y-2">{active.map(card)}</div>
      )}

      {expired.length > 0 && (
        <section className="space-y-2">
          <Button variant="ghost" size="sm" onClick={() => setShowExpired((v) => !v)}>
            {showExpired ? "إخفاء" : "عرض"} الحجوزات المنتهية ({expired.length}) — تحقّق من العربون
          </Button>
          {showExpired && <div className="space-y-2">{expired.map(card)}</div>}
        </section>
      )}
    </div>
  );
}
