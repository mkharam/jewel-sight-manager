// صفحة إشعارات كاملة — نفس بيانات جرس الإشعارات (NotificationsBell) لكن بعرض أوسع وعدد
// أكبر، حتى يقدر المشرف والموظف يراجعا كل الأحداث (سعر قُدّم لقطعة، استفسار جديد، تحويل،
// طلب إعادة طلب...) من صفحة ثابتة بدل الاقتصار على قائمة الجرس الصغيرة.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDate } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { describe, type ActivityItem } from "@/components/NotificationsBell";

const PAGE_SIZE = 100;

export default function Notifications() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data } = await supabase
      .from("activity_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);
    const list = (data ?? []) as ActivityItem[];
    const ids = Array.from(new Set(list.map((i) => i.actor_id).filter(Boolean))) as string[];
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      const map = new Map((profs ?? []).map((p: any) => [p.id, p.full_name]));
      list.forEach((i) => { i.actor_name = i.actor_id ? map.get(i.actor_id) ?? undefined : undefined; });
    }
    setItems(list);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("activity-live-page")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_log" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const described = items.map((it) => ({ it, d: describe(it) })).filter((x) => x.d);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Bell className="size-6 text-primary" />
        <h1 className="text-2xl font-bold">الإشعارات</h1>
      </div>
      <p className="text-sm text-muted-foreground -mt-2">
        كل الأحداث الحديثة: أسعار مُقدَّمة، استفسارات، تحويلات، وطلبات إعادة الطلب.
      </p>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
      ) : described.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-12">لا توجد إشعارات بعد</p>
      ) : (
        <ul className="divide-y divide-border border rounded-lg overflow-hidden bg-card">
          {described.map(({ it, d }) => {
            const Icon = d!.icon;
            return (
              <li key={it.id}>
                <Link to={d!.href} className={cn("flex gap-3 p-3 hover:bg-muted/40 transition-colors")}>
                  <div className="size-9 rounded-full bg-gold-gradient/20 flex items-center justify-center shrink-0">
                    <Icon className="size-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm leading-snug">{d!.text}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{formatDate(it.created_at)}</p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
