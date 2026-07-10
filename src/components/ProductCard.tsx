import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ImageIcon, MapPin, Tag } from "lucide-react";
import { PRODUCT_STATUS, formatCurrency, formatWeight, getImageUrl, ProductStatus } from "@/lib/constants";
import QuickQuoteSheet from "@/components/QuickQuoteSheet";

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

export default function ProductCard({ product }: { product: ProductCardData }) {
  const primary = product.images?.find((i) => i.is_primary) ?? product.images?.[0];
  const imgUrl = getImageUrl(primary?.storage_path);
  const status = PRODUCT_STATUS[product.status];

  return (
    <Card className="overflow-hidden hover:shadow-elevated transition-all hover:-translate-y-0.5 group relative">
      <Link to={`/products/${product.id}`} className="block">
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
      </Link>

      {/* زر تسجيل سعر سريع — يفتح Bottom Sheet دون مغادرة الصفحة */}
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
    </Card>
  );
}
