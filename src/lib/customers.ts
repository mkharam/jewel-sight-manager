// نظرة المدير العام على العملاء (customers_overview): فواتير أمارسوفت برقم الهاتف أو رمز الزبون + بطاقة MSTRMND،
// صف واحد لكل عميل. القائمة وملف العميل يقروا من نفس الكاش.
import { useQuery } from "@tanstack/react-query";
import { sb } from "@/lib/amarsoft";
import type { Tier } from "@/lib/loyalty";

export type CustomerRow = {
  customer_id: string; full_name: string; phone: string | null; phone9: string; notes: string | null;
  main_branch: string | null; main_branch_name: string | null; invoices: number; visit_days: number; returns: number;
  total_ld: number; grams: number; first_at: string | null; last_at: string | null; last_branch_name: string | null;
  last_salesman: string | null; last_price18: number | null; last_price21: number | null; avg_price18: number | null; avg_price21: number | null;
  tier: Tier | null; has_card: boolean; card_installed: boolean; card_level: string | null; card_discount: number | null;
  card_to_next: number | null; stamps_now: number | null; rewards_unused: number | null; gift_balance: number | null; contacted: string[];
};

export function useCustomersOverview(enabled = true) {
  return useQuery({
    queryKey: ["customers-overview"],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await sb.rpc("customers_overview");
      if (error) throw error;
      return (data ?? []) as CustomerRow[];
    },
  });
}

export const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

export function sinceText(d: number) {
  return d <= 0 ? "اليوم" : d === 1 ? "أمس" : d < 30 ? `من ${d} يوم` : d < 365 ? `من ${Math.round(d / 30)} شهر` : `من ${Math.round(d / 365)} سنة`;
}

// تاريخ ليبيا (YYYY-MM-DD).
export const tripoliDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Africa/Tripoli" });

export const ld = (n: number) => `${Math.round(n).toLocaleString("en-US")} د.ل`;
