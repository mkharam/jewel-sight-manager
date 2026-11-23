// القائمة: كل الصفحات تبان مرة وحدة بلا ما تفتح أقسام — زي شاشة التلفون.
//  • على الهاتف («المزيد»): شبكة أيقونات، أربعة في كل سطر، أيقونة في مربع وتحتها اسمها، مقسّمة بعناوين.
//  • على الكمبيوتر (الشريط الجانبي): نفس الأقسام كقوائم مفتوحة دايماً.
//  • فوقها خانة بحث: تكتب «جرد» ولا «تقييم» ولا «ولاء» وتطلعلك الصفحة — والخانات اللي داخل الصفحات برضو.
// الخانات اللي داخل الصفحات (searchOnly في src/lib/nav.ts) ما تتكررش في الشبكة — الصفحة الأم تكفي.
import { useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { isActiveItem, searchNav, type NavItem, type NavSection } from "@/lib/nav";

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
  /** صفحات موجودة في الشريط السفلي — ما تتكررش في «المزيد» (لكن تطلع في البحث). */
  hide?: string[];
}) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const hits = useMemo(() => searchNav(sections, q), [sections, q]);
  const go = (to: string) => { setQ(""); onNavigate?.(); navigate(to); };

  // الصفحة الأم تتلوّن حتى لو أنت في خانة داخلها (مثلاً «القطع» وأنت في «بلا وزن»).
  const isActive = (item: NavItem) => isActiveItem(item, pathname, search)
    || (!item.to.includes("?") && item.to !== "/" && item.to === pathname
      && !sections.some((sec) => sec.items.some((o) => o !== item && !o.searchOnly && isActiveItem(o, pathname, search))));
  const visible = sections
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.searchOnly && !hide.includes(i.to)) }))
    .filter((s) => s.items.length > 0);

  const searchBox = (
    <div className="relative">
      <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) go(hits[0].item.to); }}
        placeholder="دوّر على صفحة… (جرد، ولاء، تقييم)"
        aria-label="بحث في القائمة"
        enterKeyHint="go"
        className="h-10 w-full rounded-xl border border-input bg-background pr-9 pl-9 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden"
      />
      {q && (
        <button type="button" onClick={() => setQ("")} aria-label="مسح البحث"
          className="absolute left-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );

  if (q.trim()) {
    return (
      <div className="space-y-2">
        {searchBox}
        {hits.length ? (
          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            {hits.slice(0, 20).map(({ item, section, parent }) => (
              <button key={item.to} type="button" onClick={() => go(item.to)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-right active:bg-muted hover:bg-muted/50">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gold-soft">
                  <item.icon className="size-4 text-primary" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold leading-tight">{item.label}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {parent ? `داخل «${parent.label}»` : section.title} · {item.hint}
                  </span>
                </span>
                <Badge n={countOf(item)} />
              </button>
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">ما لقيتش صفحة بهذا الاسم — جرّب كلمة ثانية.</p>
        )}
      </div>
    );
  }

  if (variant === "list") {
    return (
      <div className="space-y-4">
        {searchBox}
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
      {searchBox}
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
