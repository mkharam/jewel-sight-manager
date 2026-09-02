import { useEffect, useState } from "react";
import { Bell, ArrowLeftRight, Tag, MessageCircle, Package, BellRing, BellOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDate } from "@/lib/constants";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { pushSupported, enablePush, disablePush } from "@/lib/push";
import { toast } from "sonner";

async function currentPushStatus(): Promise<"unsupported" | "denied" | "subscribed" | "unsubscribed"> {
  if (!pushSupported()) return "unsupported";
  if (typeof Notification !== "undefined" && Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? "subscribed" : "unsubscribed";
  } catch {
    return "unsubscribed";
  }
}

interface ActivityItem {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: any;
  created_at: string;
  actor_id: string | null;
  actor_name?: string;
}

const STATUS_LABEL: Record<string, string> = {
  status_approved: "وافق على التحويل",
  status_in_transit: "أرسل التحويل",
  status_received: "استلم التحويل",
  status_rejected: "رفض التحويل",
  status_cancelled: "ألغى التحويل",
  created: "أنشأ",
};

const PRODUCT_STATUS_AR: Record<string, string> = {
  available: "متوفرة",
  reserved: "محجوزة",
  sold: "مباعة",
  transferred: "محوّلة",
};

function describe(a: ActivityItem): { text: string; icon: any; href: string } | null {
  const actor = a.actor_name ?? "موظف";
  if (a.entity_type === "transfers") {
    const product = a.details?.product ?? "قطعة";
    if (a.action === "created") return { text: `${actor} طلب تحويل: ${product}`, icon: ArrowLeftRight, href: "/transfers" };
    if (STATUS_LABEL[a.action]) return { text: `${actor} ${STATUS_LABEL[a.action]}: ${product}`, icon: ArrowLeftRight, href: "/transfers" };
    return null;
  }
  if (a.entity_type === "products") {
    const name = a.details?.name ?? "قطعة";
    const href = a.entity_id ? `/products/${a.entity_id}` : "/";
    if (a.action === "created") return { text: `${actor} أضاف قطعة: ${name}`, icon: Package, href };
    if (a.action?.startsWith("status_")) {
      const next = a.action.replace("status_", "");
      const label = PRODUCT_STATUS_AR[next] ?? next;
      if (next === "sold") return { text: `${actor} باع القطعة: ${name} 🎉`, icon: Tag, href };
      return { text: `${actor} حدّث حالة ${name} إلى ${label}`, icon: Package, href };
    }
    return null;
  }
  if (a.entity_type === "product_quotes") {
    const price = a.details?.price;
    return { text: `${actor} أضاف سعر ${price?.toLocaleString?.() ?? price} د.ل${a.details?.customer ? ` للزبون ${a.details.customer}` : ""}`, icon: Tag, href: a.details?.product_id ? `/products/${a.details.product_id}` : "/" };
  }
  if (a.entity_type === "customer_inquiries") {
    return { text: `${actor} سجّل استفسار${a.details?.customer ? ` من ${a.details.customer}` : ""}`, icon: MessageCircle, href: "/inquiries" };
  }
  return null;
}

const LS_KEY = "lamaa.notifs.lastSeen";

export default function NotificationsBell() {
  const { user } = useAuth();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [open, setOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState<string>(() => localStorage.getItem(LS_KEY) ?? "1970-01-01");
  const [pushStatus, setPushStatus] = useState<"unsupported" | "denied" | "subscribed" | "unsubscribed">("unsubscribed");
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

  const load = async () => {
    const { data } = await supabase
      .from("activity_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);
    const list = (data ?? []) as ActivityItem[];
    const ids = Array.from(new Set(list.map((i) => i.actor_id).filter(Boolean))) as string[];
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      const map = new Map((profs ?? []).map((p: any) => [p.id, p.full_name]));
      list.forEach((i) => { i.actor_name = i.actor_id ? map.get(i.actor_id) ?? undefined : undefined; });
    }
    setItems(list);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("activity-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_log" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const unread = items.filter((i) => i.created_at > lastSeen).length;

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (o && items.length) {
      const newest = items[0].created_at;
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
            <p className="text-sm font-bold">آخر النشاطات</p>
            <p className="text-[11px] text-muted-foreground">مباشر — يتحدث تلقائياً</p>
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
        {items.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">لا توجد نشاطات بعد</div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((it) => {
              const d = describe(it);
              if (!d) return null;
              const Icon = d.icon;
              const isNew = it.created_at > lastSeen;
              return (
                <li key={it.id}>
                  <Link
                    to={d.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex gap-2 p-3 hover:bg-muted/40 transition-colors",
                      isNew && "bg-primary/5"
                    )}
                  >
                    <div className="size-8 rounded-full bg-gold-gradient/20 flex items-center justify-center shrink-0">
                      <Icon className="size-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-snug">{d.text}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{formatDate(it.created_at)}</p>
                    </div>
                    {isNew && <span className="size-2 rounded-full bg-primary self-center" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
