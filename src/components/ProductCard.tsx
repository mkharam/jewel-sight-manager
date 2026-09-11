import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { ImageIcon, MapPin, MoreVertical, Check, Barcode } from "lucide-react";
import { PRODUCT_STATUS, formatCurrency, formatWeight, getThumbUrl, ProductStatus } from "@/lib/constants";
import { GOLD_COLORS } from "@/lib/luxury";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";

export interface ProductCardData {
  id: string;
  name: string;
  sku?: string | null;
  barcode_value?: string | null;
  karat: string | null;
  gold_color?: string | null;
  weight_grams: number | null;
  ring_size: string | null;
  sale_price: number | null;
  promo_price: number | null;
  status: ProductStatus;
  branch_id?: string | null;
  branch?: { name: string } | null;
  category?: { name: string } | null;
  images?: { storage_path: string; thumb_path?: string | null; is_primary: boolean }[];
}

interface ProductCardProps {
  product: ProductCardData;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  onStatusChanged?: () => void;
  /** نسبة تشابه البحث بالصورة (0..1) — تُعرض كشارة منفصلة عن شارة العيار لتفادي التراكب. */
  similarity?: number;
}

const QUICK_STATUSES: ProductStatus[] = ["available", "reserved", "sold"];

export default function ProductCard({
  product,
  selectable,
  selected,
  similarity,
  onToggleSelect,
  onStatusChanged,
}: ProductCardProps) {
  const primary = product.images?.find((i) => i.is_primary) ?? product.images?.[0];
  const imgUrl = getThumbUrl(primary);
  const status = PRODUCT_STATUS[product.status];
  const [pending, setPending] = useState<ProductStatus | null>(null);
  const { roles, profile } = useAuth();
  const isAdmin = roles.includes("admin");
  const isManager = roles.includes("manager");
  // تغيير الحالة السريع تعديل — يقتصر على المدير العام أو المشرف على قطع فرعه فقط.
  const canEditStatus = isAdmin || (isManager && product.branch_id === profile?.branch_id);

  const quickSetStatus = async (next: ProductStatus) => {
    if (next === product.status) return;
    setPending(next);
    try {
      const { error } = await supabase.from("products").update({ status: next }).eq("id", product.id);
      if (error) throw error;
      toast.success(`تم التحديث إلى: ${PRODUCT_STATUS[next].label}`);
      onStatusChanged?.();
    } catch (e: any) {
      toast.error(e.message ?? "تعذّر تحديث الحالة");
    } finally {
      setPending(null);
    }
  };

  const inner = (
    <>
      <div className="aspect-square bg-gold-soft relative overflow-hidden">
        {imgUrl ? (
          <img
            src={imgUrl}
            alt={product.name}
            className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <ImageIcon className="size-12 opacity-30" />
          </div>
        )}
        {/* تدرّج خفيف أسفل الصورة يحسّن وضوح الشارات فوق أي صورة فاتحة */}
        <div className="absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/25 to-transparent pointer-events-none" />
        <Badge className={`absolute top-2 right-2 ${status.color} border-0 shadow-md`}>
          {status.label}
        </Badge>
        {(product.karat || product.gold_color) && (
          <Badge data-karat-badge variant="secondary" className="absolute top-2 left-2 bg-card/90 backdrop-blur border-0 shadow-sm">
            {[product.karat, GOLD_COLORS.find((c) => c.value === product.gold_color)?.label].filter(Boolean).join(" · ")}
          </Badge>
        )}
        {/* شارة نسبة تشابه البحث بالصورة — أسفل يمين الصورة تحديداً كي لا تتراكب أبداً
            مع شارتي الحالة (أعلى يمين) والعيار (أعلى يسار). */}
        {typeof similarity === "number" && (
          <span className="absolute bottom-2 right-2 z-10 text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/70 text-white backdrop-blur shadow">
            {Math.round(similarity * 100)}%
          </span>
        )}
        {selectable && (
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors" />
        )}
      </div>
      <div className="p-3 space-y-1.5">
        <h3 className="font-semibold text-sm line-clamp-1">{product.name}</h3>
        {product.sku && (
          <p className="text-[11px] font-mono text-primary/80 truncate tracking-wide" dir="ltr">
            {product.sku}
          </p>
        )}
        {product.barcode_value && (
          <p className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground truncate tracking-wide" dir="ltr">
            <Barcode className="size-3 shrink-0" />
            {product.barcode_value}
          </p>
        )}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {product.weight_grams != null && <span>{formatWeight(product.weight_grams)}</span>}
          {product.ring_size && <span>· مقاس {product.ring_size}</span>}
        </div>
        <div className="flex items-end justify-between pt-1.5 border-t border-border/60 mt-1">
          <div>
            {product.promo_price ? (
              <>
                <p className="text-xs text-muted-foreground line-through">{formatCurrency(product.sale_price)}</p>
                <p className="text-base font-bold text-primary">{formatCurrency(product.promo_price)}</p>
              </>
            ) : (
              <p className="text-base font-bold text-primary">{formatCurrency(product.sale_price)}</p>
            )}
          </div>
          {product.branch?.name && (
            <div className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
              <MapPin className="size-3" />
              {product.branch.name}
            </div>
          )}
        </div>
      </div>
    </>
  );

  return (
    <Card
      className={
        "overflow-hidden hover:shadow-elevated transition-all hover:-translate-y-0.5 group relative " +
        (selected ? "ring-2 ring-primary" : "")
      }
    >
      {selectable ? (
        <button
          type="button"
          onClick={() => onToggleSelect?.(product.id)}
          className="block w-full text-right"
        >
          {inner}
        </button>
      ) : (
        <Link to={`/products/${product.id}`} className="block">
          {inner}
        </Link>
      )}

      {/* Selection checkbox — top-left when selectable */}
      {selectable && (
        <div className="absolute top-2 left-2 z-10 size-6 rounded-md bg-card/95 backdrop-blur shadow-md flex items-center justify-center pointer-events-none">
          <Checkbox checked={!!selected} className="size-4" />
        </div>
      )}

      {/* Quick-actions row (hidden in selectable mode to keep interaction simple) */}
      {!selectable && (
        <>
          {/* Quick status menu — bottom-right of body (المدير/المشرف على فرعه فقط) */}
          {canEditStatus && (
          <div
            className="absolute bottom-2 right-2 z-10"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="secondary"
                  className="size-9 rounded-full bg-card/95 backdrop-blur shadow-md"
                  aria-label="تغيير الحالة سريعاً"
                  disabled={pending !== null}
                >
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuLabel className="text-xs">تغيير الحالة</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {QUICK_STATUSES.map((s) => (
                  <DropdownMenuItem
                    key={s}
                    onSelect={() => quickSetStatus(s)}
                    disabled={pending !== null}
                    className="cursor-pointer"
                  >
                    <span className="flex-1">{PRODUCT_STATUS[s].label}</span>
                    {product.status === s && <Check className="size-3.5 text-primary" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          )}
        </>
      )}
    </Card>
  );
}
