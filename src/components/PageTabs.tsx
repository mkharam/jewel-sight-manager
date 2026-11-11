// صفحة تلمّ عدة صفحات صغيرة في خانات (?tab=…) بدل ما كل وحدة تاخذ زر لروحها في «المزيد».
// كل خانة تتحمّل وقت ما تنفتح بس، وتبقى الصفحة بعنوانها وعرضها كيف ما هي.
import { Suspense, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export type PageTab = { key: string; label: string; render: () => ReactNode };

export default function PageTabs({ tabs }: { tabs: PageTab[] }) {
  const [params, setParams] = useSearchParams();
  const tab = tabs.find((t) => t.key === params.get("tab")) ?? tabs[0];

  return (
    <div className="space-y-4">
      <div className="max-w-3xl mx-auto flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <Button key={t.key} variant={tab.key === t.key ? "default" : "outline"} onClick={() => setParams({ tab: t.key }, { replace: true })}
            className="flex-1 min-w-[6.5rem]">
            {t.label}
          </Button>
        ))}
      </div>
      <Suspense fallback={<div className="flex justify-center py-24"><Loader2 className="size-6 animate-spin text-primary" /></div>}>
        {tab.render()}
      </Suspense>
    </div>
  );
}
