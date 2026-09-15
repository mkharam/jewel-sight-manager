import { useEffect, useState } from "react";
import { Bell, BellRing, BellOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActivityFeed } from "@/hooks/useActivityFeed";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDate, getImageUrl } from "@/lib/constants";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { enablePush, disablePush, currentPushStatus, type PushStatus } from "@/lib/push";
import { toast } from "sonner";

const LS_KEY = "lamaa.notifs.lastSeen";

export default function NotificationsBell() {
  const { user, roles } = useAuth();
  const { data: entries = [] } = useActivityFeed(30);
  const [open, setOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState<string>(() => localStorage.getItem(LS_KEY) ?? "1970-01-01");
  const [pushStatus, setPushStatus] = useState<PushStatus>("unsubscribed");
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    currentPushStatus().then(setPushStatus);
  }, []);

  const togglePush = async () => {
    if (!user) return;
    setPushBusy(true);
    try {
      if (pushStatus === "subscribed") {
        await disablePush();
        setPushStatus("unsubscribed");
        toast.success("تم إيقاف إشعارات الجهاز");
      } else {
        const ok = await enablePush();
        if (ok) {
          setPushStatus("subscribed");
          toast.success("تم تفعيل إشعارات الجهاز — ستصلك حتى لو كان التطبيق مغلقاً");
        } else {
          setPushStatus(await currentPushStatus());
          toast.error("تعذّر التفعيل — تأكد من السماح بالإشعارات من إعدادات المتصفح/الجهاز");
        }
      }
    } finally {
      setPushBusy(false);
    }
  };

  const unread = entries.filter((e) => e.item.created_at > lastSeen).length;

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (o && entries.length) {
      const newest = entries[0].item.created_at;
      localStorage.setItem(LS_KEY, newest);
      setLastSeen(newest);
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="إشعارات">
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[92vw] max-w-sm p-0 max-h-[70vh] overflow-y-auto">
        <div className="px-3 py-2 border-b border-border bg-muted/40 sticky top-0 flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-bold">{roles.includes("admin") ? "آخر النشاطات" : "ما يخصّك"}</p>
            <p className="text-[11px] text-muted-foreground">
              {roles.includes("admin") ? "كل الفروع — مباشر" : "فرعك وما يهمّك — مباشر"}
            </p>
          </div>
          {pushStatus !== "unsupported" && pushStatus !== "denied" && (
            <Button
              size="sm"
              variant={pushStatus === "subscribed" ? "secondary" : "outline"}
              className="h-8 text-xs shrink-0"
              onClick={togglePush}
              disabled={pushBusy}
            >
              {pushStatus === "subscribed" ? <BellRing className="size-3.5 ml-1" /> : <BellOff className="size-3.5 ml-1" />}
              {pushStatus === "subscribed" ? "إشعارات الجهاز مفعّلة" : "تفعيل إشعارات الجهاز"}
            </Button>
          )}
        </div>
        {entries.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">لا توجد نشاطات تخصّك بعد</div>
        ) : (
          <ul className="divide-y divide-border">
            {entries.map(({ item: it, text, icon: Icon, href, image }) => {
              const isNew = it.created_at > lastSeen;
              return (
                <li key={it.id}>
                  <Link
                    to={href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex gap-2 p-3 hover:bg-muted/40 transition-colors",
                      isNew && "bg-primary/5"
                    )}
                  >
                    <div className="size-8 rounded-full bg-gold-gradient/20 flex items-center justify-center shrink-0 overflow-hidden">
                      {image ? (
                        <img src={getImageUrl(image) ?? ""} alt="" className="size-full object-cover" loading="lazy" />
                      ) : (
                        <Icon className="size-4 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-snug">{text}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{formatDate(it.created_at)}</p>
                    </div>
                    {isNew && <span className="size-2 rounded-full bg-primary self-center" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <Link
          to="/notifications"
          onClick={() => setOpen(false)}
          className="block text-center text-sm font-semibold text-primary p-3 border-t border-border hover:bg-muted/40 transition-colors sticky bottom-0 bg-card"
        >
          عرض المزيد
        </Link>
      </PopoverContent>
    </Popover>
  );
}
