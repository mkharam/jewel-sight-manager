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
import { ImageIcon, MapPin, Tag, MoreVertical, Check } from "lucide-react";
import { PRODUCT_STATUS, formatCurrency, formatWeight, getImageUrl, ProductStatus } from "@/lib/constants";
import QuickQuoteSheet from "@/components/QuickQuoteSheet";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState } from "react";

export interface ProductCardData {
  id: string;
  name: string;
  sku?: string | null;
  karat: string | null;
  weight_grams: number | null;
  ring_size: string | null;
  sale_price: number | null;
  promo_price: number | null;
  status: ProductStatus;
  branch_id?: string | null;
  branch?: { name: string } | null;
  category?: { name: string } | null;
  images?: { storage_path: string; is_primary: boolean }[];
}

interface ProductCardProps {
  product: ProductCardData;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  onStatusChanged?: () => void;
}

const QUICK_STATUSES: ProductStatus[] = ["available", "reserved", "sold"];

export default function ProductCard({
  product,
  selectable,
  selected,
  onToggleSelect,
  onStatusChanged,
}: ProductCardProps) {
  const primary = product.images?.find((i) => i.is_primary) ?? product.images?.[0];
  const imgUrl = getImageUrl(primary?.storage_path);
  const status = PRODUCT_STATUS[product.status];
  const [pending, setPending] = useState<ProductStatus | null>(null);

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
          <img src={imgUrl} alt={product.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <ImageIcon className="size-12 opacity-30" />
          </div>
        )}
        <Badge className={`absolute top-2 right-2 ${status.color} border-0 shadow-md`}>
          {status.label}
        </Badge>
        {product.karat && (
          <Badge variant="secondary" className="absolute top-2 left-2 bg-card/90 backdrop-blur border-0">
            {product.karat}
          </Badge>
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
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {product.weight_grams != null && <span>{formatWeight(product.weight_grams)}</span>}
          {product.ring_size && <span>· مقاس {product.ring_size}</span>}
        </div>
        <div className="flex items-end justify-between pt-1">
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
          {/* زر تسجيل سعر سريع */}
          <div
            className="absolute bottom-2 left-2 z-10"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
          >
            <QuickQuoteSheet
              productId={product.id}
              productName={product.name}
              branchId={product.branch_id ?? null}
              trigger={
                <Button
                  size="icon"
                  className="size-9 rounded-full bg-gold-gradient text-primary-foreground shadow-gold"
                  aria-label="تسجيل سعر سريع"
                >
                  <Tag className="size-4" />
                </Button>
              }
            />
          </div>

          {/* Quick status menu — top-right of body, below badge */}
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
        </>
      )}
    </Card>
  );
}
