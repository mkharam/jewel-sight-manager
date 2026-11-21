// صفحة تلمّ عدة صفحات لها نفس الغرض في خانات (?tab=…) بدل ما كل وحدة تاخذ زر لروحها في القائمة.
// كل خانة: اسم، وعدد (لو فيه شي يستنى شغل)، وسطر يشرح شن فيها. الخانة تتحمّل وقت ما تنفتح بس.
import { Suspense, useEffect, useRef, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type PageTab = {
  key: string;
  label: string;
  render: () => ReactNode;
  /** سطر يشرح الخانة — يظهر تحت الخانات للخانة المفتوحة. */
  hint?: string;
  /** عدد اللي يستنى شغل في هذه الخانة (يظهر بالأحمر). */
  count?: number;
};

export default function PageTabs({ tabs }: { tabs: PageTab[] }) {
  const [params, setParams] = useSearchParams();
  const tab = tabs.find((t) => t.key === params.get("tab")) ?? tabs[0];
  const activeRef = useRef<HTMLButtonElement>(null);
  // الخانة المفتوحة تكون ظاهرة في الشريط حتى لو الخانات كثيرة على شاشة التلفون.
  useEffect(() => { activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [tab?.key]);
  if (!tab) return null;

  return (
    <div className="space-y-3">
      {tabs.length > 1 && (
        <div className="max-w-5xl mx-auto space-y-1.5">
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist">
            {tabs.map((t) => {
              const active = tab.key === t.key;
              return (
                <button
                  key={t.key}
                  ref={active ? activeRef : undefined}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setParams({ tab: t.key }, { replace: true })}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors",
                    active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-secondary",
                  )}
                >
                  {t.label}
                  {!!t.count && t.count > 0 && (
                    <span className={cn("min-w-[20px] rounded-full px-1.5 text-center text-[11px] font-bold tabular-nums",
                      active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-destructive text-destructive-foreground")}>
                      {t.count > 999 ? "999+" : t.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {tab.hint && <p className="px-1 text-xs text-muted-foreground">{tab.hint}</p>}
        </div>
      )}
      <Suspense fallback={<div className="flex justify-center py-24"><Loader2 className="size-6 animate-spin text-primary" /></div>}>
        {tab.render()}
      </Suspense>
    </div>
  );
}
