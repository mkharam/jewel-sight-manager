// القائمة: كل الصفحات تبان مرة وحدة بلا ما تفتح أقسام — زي شاشة التلفون.
//  • على الهاتف («المزيد»): شبكة أيقونات، أربعة في كل سطر، أيقونة في مربع وتحتها اسمها، مقسّمة بعناوين.
//  • على الكمبيوتر (الشريط الجانبي): نفس الأقسام كقوائم مفتوحة دايماً.
// الخانات اللي داخل الصفحات (searchOnly في src/lib/nav.ts) ما تتكررش هنا — الصفحة الأم تكفي.
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { isActiveItem, type NavItem, type NavSection } from "@/lib/nav";

function Badge({ n, className }: { n: number; className?: string }) {
  if (n <= 0) return null;
  return (
    <span className={cn("min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center tabular-nums", className)}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

export default function NavMenu({ sections, countOf, onNavigate, variant, hide = [] }: {
  sections: NavSection[];
  countOf: (i: NavItem) => number;
  onNavigate?: () => void;
  /** grid = «المزيد» على الهاتف، list = الشريط الجانبي على الكمبيوتر. */
  variant: "grid" | "list";
  /** صفحات موجودة في الشريط السفلي — ما تتكررش في «المزيد». */
  hide?: string[];
}) {
  const { pathname, search } = useLocation();
  // الصفحة الأم تتلوّن حتى لو أنت في خانة داخلها (مثلاً «قطع تحتاج متابعة» وأنت في «بلا وزن»).
  const isActive = (item: NavItem) => isActiveItem(item, pathname, search)
    || (!item.to.includes("?") && item.to !== "/" && item.to === pathname
      && !sections.some((sec) => sec.items.some((o) => o !== item && !o.searchOnly && isActiveItem(o, pathname, search))));
  const visible = sections
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.searchOnly && !hide.includes(i.to)) }))
    .filter((s) => s.items.length > 0);

  if (variant === "list") {
    return (
      <div className="space-y-4">
        {visible.map((s) => (
          <div key={s.key} className="space-y-0.5">
            <p className="px-3 pb-1 text-[11px] font-bold text-muted-foreground">{s.title}</p>
            {s.items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} onClick={() => onNavigate?.()}
                className={cn("flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                  isActive(item) ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground")}>
                <item.icon className="size-5 shrink-0" />
                <span className="flex-1 leading-tight">{item.label}</span>
                <Badge n={countOf(item)} />
              </NavLink>
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {visible.map((s) => {
        const quiet = s.key === "more";
        return (
          <div key={s.key}>
            <p className="mb-1.5 px-1 text-xs font-bold text-muted-foreground">{s.title}</p>
            <div className="grid grid-cols-4 gap-x-1 gap-y-3 rounded-2xl bg-muted/40 p-2">
              {s.items.map((item) => {
                const active = isActive(item);
                return (
                  <NavLink key={item.to} to={item.to} end={item.end} onClick={() => onNavigate?.()}
                    className={cn("relative flex flex-col items-center gap-1 rounded-xl py-1.5 active:bg-muted", active ? "text-primary" : "text-foreground")}>
                    <span className={cn("relative flex size-11 items-center justify-center rounded-2xl",
                      active ? "bg-primary text-primary-foreground" : quiet ? "border border-border bg-card" : "bg-gold-soft")}>
                      <item.icon className={cn("size-5", active ? "" : quiet ? "text-muted-foreground" : "text-primary")} />
                      <Badge n={countOf(item)} className="absolute -top-1 -left-1" />
                    </span>
                    <span className="line-clamp-2 px-0.5 text-center text-[11px] font-semibold leading-tight">{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
