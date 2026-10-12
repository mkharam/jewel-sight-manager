// إيصال البيع — يفتح تلقائياً بعد تسجيل أي بيع: يُطبع للزبون، أو يُرسل له على الواتساب
// مباشرة إن كُتب رقمه في البيع. صفحة مستقلة بلا شريط تنقّل حتى تُطبع نظيفة (ورق حراري أو A4).
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowRight, Loader2, MessageCircle, Printer, Share2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate, formatWeight } from "@/lib/constants";
import { whatsappLink } from "@/lib/whatsapp";
import { sharePiece } from "@/lib/sharePiece";
import { toast } from "sonner";

type SaleRow = {
  id: string;
  product_id: string | null;
  product_name_snapshot: string | null;
  sku_snapshot: string | null;
  karat: string | null;
  weight_grams: number | null;
  final_price: number;
  quantity: number | null;
  discount: number | null;
  payment_method: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  amar_invoice_number: string | null;
  notes: string | null;
  sold_at: string;
  returned_at: string | null;
  branch: { name: string; phone: string | null; location: string | null } | null;
  seller: { full_name: string } | null;
};

/** رقم قصير مقروء من معرّف البيع — يكفي للمراجعة والبحث دون عمود ترقيم منفصل. */
export const receiptNumber = (id: string) => id.replace(/-/g, "").slice(0, 8).toUpperCase();

export function receiptText(s: SaleRow): string {
  return [
    `مخرّم للمجوهرات${s.branch?.name ? ` — ${s.branch.name}` : ""}`,
    `إيصال بيع رقم ${receiptNumber(s.id)}`,
    formatDate(s.sold_at),
    "",
    s.product_name_snapshot ?? "",
    [s.karat, s.weight_grams != null ? formatWeight(s.weight_grams) : null].filter(Boolean).join(" · "),
    s.sku_snapshot ? `رقم القطعة: ${s.sku_snapshot}` : "",
    (s.quantity ?? 1) > 1 ? `العدد: ${s.quantity}` : "",
    s.discount ? `الخصم: ${formatCurrency(s.discount)}` : "",
    `المبلغ: ${formatCurrency(s.final_price)}${s.payment_method ? ` (${s.payment_method})` : ""}`,
    "",
    "شكراً لتسوّقكم معنا",
  ].filter((l, i, a) => l !== "" || (a[i - 1] ?? "") !== "").join("\n").trim();
}

export default function SaleReceipt() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: sale, isLoading } = useQuery({
    queryKey: ["sale-receipt", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("*, branch:branches(name,phone,location), seller:profiles!sales_sold_by_fkey(full_name)")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as SaleRow | null;
    },
  });

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="size-6 animate-spin text-primary" /></div>;
  }
  if (!sale) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p>الإيصال غير موجود أو لا تملك صلاحية عرضه.</p>
        <Button variant="outline" onClick={() => navigate("/")}>العودة للبحث</Button>
      </div>
    );
  }

  const text = receiptText(sale);
  const waLink = whatsappLink(sale.customer_phone, text);
  const onShare = async () => {
    const r = await sharePiece(text, null);
    if (r === "copied") toast.success("نُسخ الإيصال — الصقه في الواتساب");
  };

  return (
    <div className="min-h-screen bg-background p-4 print:p-0 print:bg-white" dir="rtl">
      <div className="mx-auto max-w-sm space-y-3">
        <div className="flex gap-2 print:hidden">
          <Button variant="ghost" size="sm" onClick={() => (sale.product_id ? navigate(`/products/${sale.product_id}`) : navigate("/"))}>
            <ArrowRight className="size-4 ml-1" /> رجوع
          </Button>
        </div>

        <div className="rounded-2xl border bg-white text-black p-5 shadow-card print:shadow-none print:border-0 print:rounded-none">
          <div className="text-center space-y-1">
            <img src={`${import.meta.env.BASE_URL}brand-logo.webp`} alt="مخرّم" className="size-14 rounded-xl mx-auto" />
            <h1 className="text-xl font-extrabold">مخرّم للمجوهرات</h1>
            {sale.branch?.name && <p className="text-sm">فرع {sale.branch.name}</p>}
            {(sale.branch?.location || sale.branch?.phone) && (
              <p className="text-xs text-neutral-600">
                {[sale.branch?.location, sale.branch?.phone].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>

          <div className="my-4 border-t border-dashed border-neutral-400" />

          <div className="flex justify-between text-sm">
            <span className="font-bold">إيصال بيع</span>
            <span className="font-mono" dir="ltr">#{receiptNumber(sale.id)}</span>
          </div>
          <p className="text-xs text-neutral-600">{formatDate(sale.sold_at)}</p>
          {sale.returned_at && <p className="mt-1 text-sm font-bold text-red-600">⚠️ تم إرجاع هذا البيع</p>}

          <div className="my-4 border-t border-dashed border-neutral-400" />

          <dl className="space-y-1.5 text-sm">
            <Row label="القطعة" value={sale.product_name_snapshot} />
            <Row label="رقم القطعة" value={sale.sku_snapshot} ltr />
            <Row label="العيار" value={sale.karat} />
            <Row label="الوزن" value={sale.weight_grams != null ? formatWeight(sale.weight_grams) : null} />
            {(sale.quantity ?? 1) > 1 && <Row label="العدد" value={String(sale.quantity)} />}
            {!!sale.discount && <Row label="الخصم" value={formatCurrency(sale.discount)} />}
          </dl>

          <div className="my-4 border-t border-dashed border-neutral-400" />

          <div className="flex items-baseline justify-between">
            <span className="font-bold">المبلغ المدفوع</span>
            <span className="text-2xl font-extrabold">{formatCurrency(sale.final_price)}</span>
          </div>
          <dl className="mt-2 space-y-1.5 text-sm">
            <Row label="طريقة الدفع" value={sale.payment_method} />
            <Row label="الزبون" value={sale.customer_name} />
            <Row label="هاتف الزبون" value={sale.customer_phone} ltr />
            <Row label="البائع" value={sale.seller?.full_name} />
            <Row label="فاتورة عمار" value={sale.amar_invoice_number} ltr />
            <Row label="ملاحظات" value={sale.notes} />
          </dl>

          <div className="my-4 border-t border-dashed border-neutral-400" />
          <p className="text-center text-sm">شكراً لتسوّقكم معنا</p>
        </div>

        <div className="grid grid-cols-2 gap-2 print:hidden">
          <Button size="lg" onClick={() => window.print()} className="bg-gold-gradient text-primary-foreground shadow-gold">
            <Printer className="size-4 ml-1" /> طباعة
          </Button>
          {waLink ? (
            <a href={waLink} target="_blank" rel="noopener noreferrer">
              <Button size="lg" variant="outline" className="w-full">
                <MessageCircle className="size-4 ml-1" /> واتساب الزبون
              </Button>
            </a>
          ) : (
            <Button size="lg" variant="outline" onClick={onShare}>
              <Share2 className="size-4 ml-1" /> إرسال
            </Button>
          )}
        </div>
        <Link to="/" className="block print:hidden">
          <Button variant="ghost" className="w-full">العودة للبحث</Button>
        </Link>
      </div>
    </div>
  );
}

function Row({ label, value, ltr }: { label: string; value: string | null | undefined; ltr?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-neutral-600">{label}</dt>
      <dd className="text-left font-medium" dir={ltr ? "ltr" : undefined}>{value}</dd>
    </div>
  );
}
