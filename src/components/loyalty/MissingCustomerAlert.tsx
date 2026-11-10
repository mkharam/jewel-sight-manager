// فواتير الفرع اللي تسجّلت في أمارسوفت بلا رقم الزبون (ولا حتى اسمه). أمارسوفت ما يفرضش الزبون، فهنا تقعد قدام
// الموظف لين يفتحها في أمارسوفت ويختار الزبون: تختفي وحدها أول ما يوصل الرقم (amarsoft_missing_customer_open).
// الإشعار يوصل لموظفين الفرع وللمدير العام في نفس اللحظة اللي تتسجّل فيها الفاتورة.
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { sb } from "@/lib/amarsoft";
import { tripoliDate } from "@/lib/customers";

type Missing = {
  invoice_id: number; branch_code: string; branch_name: string; invoice_no: string; sold_at: string; net_ld: number;
  sman: string | null; customer: string | null; missing: "phone" | "phone_name"; alerted_at: string;
};

const n0 = (n: number) => Math.round(Number(n)).toLocaleString("en-US");
const invs = (n: number) => (n === 1 ? "فاتورة وحدة" : n === 2 ? "فاتورتين" : n <= 10 ? `${n} فواتير` : `${n} فاتورة`);
const when = (iso: string) => {
  const t = new Date(iso).toLocaleTimeString("ar-LY", { timeZone: "Africa/Tripoli", hour: "numeric", minute: "2-digit" });
  const d = tripoliDate(iso);
  return d === tripoliDate(new Date().toISOString()) ? t : d === tripoliDate(new Date(Date.now() - 86_400_000).toISOString()) ? `أمس ${t}` : `${d.slice(8)}/${d.slice(5, 7)} ${t}`;
};

export default function MissingCustomerAlert({ branch }: { branch: string | null }) {
  const { data } = useQuery({
    queryKey: ["missing-customer", branch],
    queryFn: async () => {
      const { data, error } = await sb.rpc("amarsoft_missing_customer_open", { p_branch: branch });
      if (error) throw error;
      return (data ?? []) as Missing[];
    },
    refetchInterval: 10_000,
  });
  if (!data?.length) return null;
  return (
    <div className="rounded-xl border border-red-300 bg-red-50 text-red-950 dark:bg-red-950/40 dark:text-red-100 p-3 space-y-2">
      <p className="font-bold flex items-center gap-2">
        <AlertTriangle className="size-5 shrink-0" /> {invs(data.length)} لازم {data.length === 1 ? "تتعدّل" : "يتعدّلو"} في أمارسوفت: بلا رقم الزبون
      </p>
      <p className="text-xs opacity-90">
        افتح الفاتورة في أمارسوفت، اختار الزبون من القائمة (ولا سجّله باسمه ورقم موبايله) واحفظ. تختفي من هنا وحدها في ثواني.
      </p>
      <div className="divide-y divide-red-200 dark:divide-red-900/60">
        {data.map((x) => (
          <div key={x.invoice_id} className="py-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="font-bold">{branch ? "" : `${x.branch_name} `}#{x.invoice_no}</span>
            <span className="text-xs opacity-80">{when(x.sold_at)} · {n0(x.net_ld)} د.ل{x.sman ? ` · ${x.sman}` : ""}</span>
            <span className={`text-[11px] rounded-full px-2 py-0.5 ${x.missing === "phone_name" ? "bg-red-600 text-white" : "bg-amber-100 text-amber-900"}`}>
              {x.missing === "phone_name" ? "بلا اسم ولا رقم" : `بلا رقم${x.customer ? ` · ${x.customer}` : ""}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
