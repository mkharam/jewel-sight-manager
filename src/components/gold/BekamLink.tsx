// ربط «بكم»: حالة القراءة التلقائية لأسعار السوق، والمدير العام يحط كوكي دخول جديد لما الجلسة تنتهي.
// الكوكي ينحفظ في قاعدة البيانات (bekam_auth) وما يرجعش للتطبيق أبداً — الحالة بس (bekam_status).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { formatTripoli, sb } from "@/lib/amarsoft";

type Status = { connected: boolean; last_ok_at: string | null; last_error: string | null };

export default function BekamLink() {
  const { roles } = useAuth();
  const isAdmin = roles.includes("admin");
  const qc = useQueryClient();
  const [cookie, setCookie] = useState("");
  const [saving, setSaving] = useState(false);
  const { data, error } = useQuery({
    queryKey: ["bekam-status"],
    enabled: isAdmin,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await sb.rpc("bekam_status");
      if (error) throw error;
      return ((data ?? [])[0] ?? null) as Status | null;
    },
  });
  if (!isAdmin || error) return null; // قبل تشغيل ملف التحديث: ما نوريوش حاجة

  const stale = !data?.last_ok_at || Date.now() - new Date(data.last_ok_at).getTime() > 3 * 3600_000;
  const save = async () => {
    // يقبل «PHPSESSID=…» ولا القيمة بروحها.
    const v = cookie.trim().includes("=") ? cookie.trim() : `PHPSESSID=${cookie.trim()}`;
    if (v.length < 15) return toast.error("الصق قيمة PHPSESSID من المتصفح");
    setSaving(true);
    const { error } = await sb.rpc("bekam_set_cookie", { p_cookie: v });
    setSaving(false);
    if (error) return toast.error(error.message);
    setCookie("");
    toast.success("تم — أسعار «بكم» تتقرا خلال 10 دقايق");
    qc.invalidateQueries({ queryKey: ["bekam-status"] });
  };

  return (
    <Card className={`space-y-2 p-3 ${data?.connected && !stale ? "" : "border-amber-500/50"}`}>
      <p className="text-sm font-bold">ربط «بكم»</p>
      <p className="text-xs text-muted-foreground">
        {!data?.connected ? "مش مربوط بعد — حط كوكي الدخول تحت."
          : data.last_error ? `⚠️ ${data.last_error}`
          : data.last_ok_at ? `شغال — آخر قراءة ${formatTripoli(data.last_ok_at)}.` : "مربوط — أول قراءة خلال 10 دقايق."}
      </p>
      {(!data?.connected || stale || data.last_error) && (
        <>
          <p className="text-[11px] text-muted-foreground">
            افتح bekam.net وانت داخل ← F12 ← Application ← Cookies ← bekam.net، وانسخ قيمة PHPSESSID.
          </p>
          <div className="flex gap-2">
            <Input value={cookie} onChange={(e) => setCookie(e.target.value)} placeholder="PHPSESSID" dir="ltr" className="flex-1" />
            <Button onClick={save} disabled={saving || !cookie.trim()}>حفظ</Button>
          </div>
        </>
      )}
    </Card>
  );
}
