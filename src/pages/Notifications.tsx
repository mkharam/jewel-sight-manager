// صفحة إشعارات كاملة — نفس تغذية جرس الإشعارات (useActivityFeed) لكن بعدد أكبر وعرض
// أوسع. التصفية واحدة في المكانين: الموظف يرى ما يخصّ فرعه وما يهمّ المحلات كلها،
// والمدير العام يرى كل شيء.
import { Loader2, Bell } from "lucide-react";
import { Link } from "react-router-dom";
import { formatDate } from "@/lib/constants";
import { useAuth } from "@/hooks/useAuth";
import { useActivityFeed } from "@/hooks/useActivityFeed";

const PAGE_SIZE = 100;

export default function Notifications() {
  const { roles } = useAuth();
  const isAdmin = roles.includes("admin");
  const { data: entries = [], isLoading } = useActivityFeed(PAGE_SIZE);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Bell className="size-6 text-primary" />
        <h1 className="text-2xl font-bold">{isAdmin ? "الإشعارات" : "ما يخصّك"}</h1>
      </div>
      <p className="text-sm text-muted-foreground -mt-2">
        {isAdmin
          ? "كل ما يجري في المحلات: بيع، أسعار مُقدَّمة، استفسارات، تحويلات، وطلبات إعادة الطلب."
          : "ما يجري في فرعك، إضافةً إلى استفسارات الزبائن ووصول البضاعة المطلوبة."}
      </p>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
      ) : entries.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-12">لا توجد إشعارات بعد</p>
      ) : (
        <ul className="divide-y divide-border border rounded-lg overflow-hidden bg-card">
          {entries.map(({ item, text, icon: Icon, href }) => (
            <li key={item.id}>
              <Link to={href} className="flex gap-3 p-3 hover:bg-muted/40 transition-colors">
                <div className="size-9 rounded-full bg-gold-gradient/20 flex items-center justify-center shrink-0">
                  <Icon className="size-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm leading-snug">{text}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{formatDate(item.created_at)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
