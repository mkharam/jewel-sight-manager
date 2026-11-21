// القائمة الكاملة — نفس المكوّن في «القائمة» على الهاتف وفي الشريط الجانبي على الكمبيوتر:
//  • بحث: اكتب اسم أي صفحة (أو شي يوصفها: «زبون»، «تصليح»، «خصم») وتطلع فوراً.
//  • آخر صفحات فتحتها.
//  • أقسام منفصلة، كل قسم يتفتح ويتسكّر لروحه، وعلى كل قسم مجموع التنبيهات اللي داخله.
import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronDown, Clock, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { isActiveItem, readRecent, searchNav, type NavItem, type NavSection } from "@/lib/nav";

const OPEN_KEY = "nav.openSections";

function Badge({ n, className }: { n: number; className?: string }) {
  if (n <= 0) return null;
  return (
    <span className={cn("min-w-[20px] h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold flex items-center justify-center tabular-nums", className)}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

export default function NavMenu({ sections, countOf, onNavigate, compact = false, autoFocusSearch = false }: {
  sections: NavSection[];
  countOf: (i: NavItem) => number;
  onNavigate?: () => void;
  /** الشريط الجانبي: صفوف أصغر بلا وصف. */
  compact?: boolean;
  autoFocusSearch?: boolean;
}) {
  const { pathname, search } = useLocation();
  const [q, setQ] = useState("");
  const current = sections.find((s) => s.items.some((i) => isActiveItem(i, pathname, search)));
  const [open, setOpen] = useState<Set<string>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "null");
      if (Array.isArray(saved)) return new Set(saved);
    } catch { /* ignore */ }
    return new Set(compact ? sections.map((s) => s.key) : [sections[0]?.key].filter(Boolean) as string[]);
  });
  // القسم اللي فيه الصفحة الحالية يتفتح دايماً.
  useEffect(() => {
    if (current && !open.has(current.key)) setOpen((o) => new Set(o).add(current.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.key]);
  const toggle = (key: string) => setOpen((o) => {
    const n = new Set(o);
    if (n.has(key)) n.delete(key); else n.add(key);
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...n])); } catch { /* ignore */ }
    return n;
  });

  const all = useMemo(() => sections.flatMap((s) => s.items.map((item) => ({ section: s, item }))), [sections]);
  const recent = useMemo(() => readRecent()
    .map((to) => all.find((x) => x.item.to === to))
    .filter((x): x is { section: NavSection; item: NavItem } => !!x)
    .slice(0, 4), [all, pathname, search]); // eslint-disable-line react-hooks/exhaustive-deps
  const results = useMemo(() => searchNav(sections, q), [sections, q]);

  const Row = ({ item, section, showSection }: { item: NavItem; section: NavSection; showSection?: boolean }) => {
    const active = isActiveItem(item, pathname, search);
    return (
      <NavLink
        to={item.to}
        end={item.end}
        onClick={() => { setQ(""); onNavigate?.(); }}
        className={cn(
          "flex items-center gap-3 rounded-xl transition-colors",
          compact ? "px-2.5 py-2" : "px-3 py-2.5",
          active ? "bg-primary/12 text-primary" : "hover:bg-secondary/70 active:bg-secondary",
        )}
      >
        <span className={cn("flex shrink-0 items-center justify-center rounded-lg", compact ? "size-8" : "size-10", active ? "bg-primary text-primary-foreground" : section.tone)}>
          <item.icon className={compact ? "size-4" : "size-5"} />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate font-semibold", compact ? "text-sm" : "text-[15px]")}>{item.label}</span>
          {!compact && <span className="block truncate text-xs text-muted-foreground">{showSection ? `${section.title} · ${item.hint}` : item.hint}</span>}
        </span>
        <Badge n={countOf(item)} />
      </NavLink>
    );
  };

  return (
    <div className="space-y-3">
      {/* البحث */}
      <div className="relative">
        <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus={autoFocusSearch}
          placeholder="وين تبي تمشي؟ اكتب اسم الصفحة…"
          className={cn("w-full rounded-xl border border-input bg-background pr-9 pl-9 outline-none focus:ring-2 focus:ring-primary/40", compact ? "h-9 text-sm" : "h-11 text-[15px]")}
        />
        {q && (
          <button onClick={() => setQ("")} aria-label="مسح" className="absolute left-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground">
            <X className="size-4" />
          </button>
        )}
      </div>

      {q ? (
        <div className="space-y-1">
          {results.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">ما فيش صفحة بهذا الاسم</p>
          ) : results.map(({ section, item }) => <Row key={item.to + section.key} item={item} section={section} showSection />)}
        </div>
      ) : (
        <>
          {/* آخر صفحات */}
          {recent.length > 0 && (
            <div>
              <p className="mb-1.5 flex items-center gap-1 px-1 text-xs font-bold text-muted-foreground"><Clock className="size-3.5" /> آخر صفحات فتحتها</p>
              <div className={cn("grid gap-1.5", compact ? "grid-cols-1" : "grid-cols-2")}>
                {recent.map(({ item, section }) => (
                  <NavLink key={item.to} to={item.to} end={item.end} onClick={() => onNavigate?.()}
                    className="flex items-center gap-2 rounded-xl border bg-card px-2.5 py-2 text-sm font-semibold active:bg-secondary">
                    <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", section.tone)}><item.icon className="size-4" /></span>
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          )}

          {/* الأقسام */}
          <div className="space-y-2">
            {sections.map((s) => {
              const isOpen = open.has(s.key);
              const total = s.items.reduce((n, i) => n + countOf(i), 0);
              return (
                <div key={s.key} className={cn("overflow-hidden rounded-2xl border bg-card", current?.key === s.key && "border-primary/40")}>
                  <button onClick={() => toggle(s.key)} className={cn("flex w-full items-center gap-3 text-right active:bg-secondary/60", compact ? "px-2.5 py-2" : "px-3 py-3")} aria-expanded={isOpen}>
                    <span className={cn("flex shrink-0 items-center justify-center rounded-xl", compact ? "size-8" : "size-10", s.tone)}>
                      <s.icon className={compact ? "size-4" : "size-5"} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block font-bold", compact ? "text-sm" : "text-base")}>{s.title}</span>
                      {!compact && !isOpen && <span className="block truncate text-xs text-muted-foreground">{s.hint}</span>}
                    </span>
                    {!isOpen && <Badge n={total} />}
                    <span className="text-xs text-muted-foreground tabular-nums">{s.items.length}</span>
                    <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
                  </button>
                  {isOpen && (
                    <div className={cn("space-y-0.5 border-t", compact ? "p-1" : "p-1.5")}>
                      {s.items.map((item) => <Row key={item.to} item={item} section={s} />)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
