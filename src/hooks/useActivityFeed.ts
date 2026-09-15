// مصدر واحد لتغذية الإشعارات — يستخدمه جرس الإشعارات وصفحة الإشعارات معاً، فيبقيان
// متطابقين ويتشاركان الكاش بدل استعلامين منفصلين واشتراكَي realtime مكرّرين.
import { useEffect, useId } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { describe, isRelevant, dropDuplicateSaleEvents, type ActivityItem } from "@/lib/notifications";

export interface FeedEntry {
  item: ActivityItem;
  text: string;
  icon: any;
  href: string;
}

/**
 * نجلب أكثر مما نعرض لأن التصفية تحذف جزءاً كبيراً (أفعال المستخدم نفسه، وأحداث فروع
 * أخرى). بدون هذا الهامش كان الموظف يفتح الجرس فيجده شبه فارغ رغم وجود ما يخصّه أقدم
 * بقليل.
 */
const FETCH_MULTIPLIER = 6;
const MAX_FETCH = 400;

export function useActivityFeed(limit: number) {
  const qc = useQueryClient();
  const { user, profile, roles } = useAuth();
  const isAdmin = roles.includes("admin");
  const branchId = profile?.branch_id ?? null;

  // اسم القناة يجب أن يكون فريداً لكل نسخة من الخطّاف: صفحة الإشعارات تُركَّب بينما
  // جرس الإشعارات مركَّب أصلاً في الهيكل، فيطلبان الاسم نفسه — وsupabase-js يُعيد
  // القناة القائمة ذاتها، وإضافة on() إليها بعد subscribe() ترمي خطأً يُسقط الصفحة.
  const channelId = useId();

  // الاشتراك يُبطل الكاش المشترك فقط — البيانات نفسها تأتي من استعلام react-query واحد.
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`activity-live-${channelId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_log" }, () => {
        qc.invalidateQueries({ queryKey: ["activity-feed"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, qc, channelId]);

  const query = useQuery({
    queryKey: ["activity-feed", user?.id, branchId, isAdmin, limit],
    enabled: !!user,
    queryFn: async (): Promise<FeedEntry[]> => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(Math.min(limit * FETCH_MULTIPLIER, MAX_FETCH));
      if (error) throw error;

      const list = dropDuplicateSaleEvents((data ?? []) as ActivityItem[]);
      const ctx = { userId: user?.id ?? null, branchId, isAdmin };
      const mine = list.filter((i) => isRelevant(i, ctx));

      // أسماء الفاعلين تُجلب بعد التصفية لا قبلها — استعلام أصغر وأسرع.
      const ids = Array.from(new Set(mine.map((i) => i.actor_id).filter(Boolean))) as string[];
      if (ids.length) {
        const { data: profs } = await supabase.from("staff_directory").select("id, full_name").in("id", ids);
        const map = new Map((profs ?? []).map((p: any) => [p.id, p.full_name]));
        mine.forEach((i) => { i.actor_name = i.actor_id ? map.get(i.actor_id) ?? undefined : undefined; });
      }

      const entries: FeedEntry[] = [];
      for (const item of mine) {
        const d = describe(item);
        if (d) entries.push({ item, ...d });
        if (entries.length >= limit) break;
      }
      return entries;
    },
  });

  return query;
}
