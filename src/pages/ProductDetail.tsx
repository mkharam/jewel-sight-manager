import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { ArrowRight, Edit, ImageIcon, MapPin, MessageCircle, Tag, Trash2, User, ArrowLeftRight, Sparkles, Copy, Share2, CheckCircle2, ShieldCheck } from "lucide-react";
import { PRODUCT_STATUS, formatCurrency, formatDate, formatWeight, getImageUrl } from "@/lib/constants";
import { toast } from "sonner";
import QuickQuoteSheet from "@/components/QuickQuoteSheet";
import SellDialog from "@/components/SellDialog";
import ReserveDialog from "@/components/ReserveDialog";

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, roles, profile } = useAuth();
  const canEdit = !!user;
  const isAdmin = roles.includes("admin");
  const isManager = roles.includes("manager");
  const [activeImage, setActiveImage] = useState(0);


  const { data: product, isLoading } = useQuery({
    queryKey: ["product", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(`
          *,
          branch:branches(id,name),
          category:categories(id,name),
          images:product_images(id,storage_path,is_primary,sort_order),
          creator:profiles!products_created_by_fkey(full_name)
        `)
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: quotes } = useQuery({
    queryKey: ["quotes", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("product_quotes")
        .select("*, branch:branches(name), staff:profiles!product_quotes_quoted_by_fkey(full_name)")
        .eq("product_id", id!)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
    enabled: !!id,
  });

  const { data: inquiries } = useQuery({
    queryKey: ["product-inquiries", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("customer_inquiries")
        .select("*, branch:branches(name), staff:profiles!customer_inquiries_created_by_fkey(full_name)")
        .eq("product_id", id!)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
    enabled: !!id,
  });

  // بث مباشر للأسعار والاستفسارات لهذه القطعة
  useEffect(() => {
    if (!id) return;
    const ch = supabase
      .channel(`product-${id}-live`)
      .on("postgres_changes", { event: "*", schema: "public", table: "product_quotes", filter: `product_id=eq.${id}` }, () => {
        qc.invalidateQueries({ queryKey: ["quotes", id] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "customer_inquiries", filter: `product_id=eq.${id}` }, () => {
        qc.invalidateQueries({ queryKey: ["product-inquiries", id] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, qc]);

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">جارٍ التحميل...</div>;
  if (!product) return <div className="p-8 text-center">القطعة غير موجودة</div>;

  const status = PRODUCT_STATUS[product.status as keyof typeof PRODUCT_STATUS];
  const sortedImages = [...(product.images ?? [])].sort((a, b) =>
    (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0) || a.sort_order - b.sort_order
  );

  const onDelete = async () => {
    if (!confirm("حذف هذه القطعة نهائياً؟")) return;
    const { error } = await supabase.from("products").delete().eq("id", id!);
    if (error) return toast.error(error.message);
    await supabase.from("activity_log").insert({
      actor_id: user?.id, action: "delete", entity_type: "product", entity_id: id,
      details: { name: product.name },
    });
    toast.success("تم الحذف");
    navigate("/");
  };

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowRight className="size-4 ml-1" /> رجوع
        </Button>
        <div className="flex gap-2">
          {canEdit && (
            <Link to={`/products/${id}/edit`}>
              <Button variant="outline" size="sm"><Edit className="size-4 ml-1" /> تعديل</Button>
            </Link>
          )}
          {roles.includes("admin") && (
            <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive">
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Images */}
        <Card className="overflow-hidden">
          <div className="aspect-square bg-gold-soft">
            {sortedImages[0] ? (
              <img src={getImageUrl(sortedImages[0].storage_path)!} alt={product.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                <ImageIcon className="size-16 opacity-30" />
              </div>
            )}
          </div>
          {sortedImages.length > 1 && (
            <div className="grid grid-cols-4 gap-1 p-2">
              {sortedImages.slice(1).map((img) => (
                <div key={img.id} className="aspect-square bg-muted rounded overflow-hidden">
                  <img src={getImageUrl(img.storage_path)!} alt="" className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Info */}
        <div className="space-y-3">
          <Card className="p-5 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h1 className="text-2xl font-bold">{product.name}</h1>
                {product.category?.name && (
                  <p className="text-sm text-muted-foreground">{product.category.name}</p>
                )}
              </div>
              <Badge className={`${status.color} border-0`}>{status.label}</Badge>
            </div>

            <div className="grid grid-cols-2 gap-y-3 text-sm pt-2 border-t border-border">
              <Spec label="القيراط" value={product.karat} />
              <Spec label="الوزن" value={formatWeight(product.weight_grams)} />
              {product.ring_size && <Spec label="المقاس" value={product.ring_size} />}
              {product.item_type && <Spec label="النوع" value={product.item_type} />}
              <Spec label="الفرع" value={product.branch?.name} icon={<MapPin className="size-3.5" />} />
              <Spec label="SKU" value={product.sku ?? "—"} />
            </div>

            <div className="pt-3 border-t border-border">
              {product.promo_price ? (
                <div>
                  <p className="text-sm text-muted-foreground line-through">{formatCurrency(product.sale_price)}</p>
                  <p className="text-3xl font-extrabold text-primary">{formatCurrency(product.promo_price)}</p>
                  <Badge variant="secondary" className="mt-1">سعر عرض</Badge>
                </div>
              ) : (
                <p className="text-3xl font-extrabold text-primary">{formatCurrency(product.sale_price)}</p>
              )}
              {canEdit && product.cost_price != null && (
                <p className="text-xs text-muted-foreground mt-1">التكلفة: {formatCurrency(product.cost_price)}</p>
              )}
            </div>

            {product.description && (
              <div className="pt-3 border-t border-border">
                <p className="text-xs font-semibold text-muted-foreground mb-1">الوصف</p>
                <p className="text-sm">{product.description}</p>
              </div>
            )}
            {product.internal_notes && canEdit && (
              <div className="pt-3 border-t border-border bg-warning/10 -mx-5 -mb-5 px-5 pb-5 rounded-b-xl">
                <p className="text-xs font-semibold text-warning-foreground mb-1">ملاحظات داخلية (للموظفين فقط)</p>
                <p className="text-sm">{product.internal_notes}</p>
              </div>
            )}
          </Card>

          <QuickQuoteSheet productId={id!} productName={product.name} branchId={product.branch_id} fullWidthButton />
          <Link to={`/transfers?product=${id}&name=${encodeURIComponent(product.name)}`} className="block">
            <Button variant="outline" size="lg" className="w-full">
              <ArrowLeftRight className="size-4 ml-1" /> طلب تحويل لفرعي
            </Button>
          </Link>
          {/* بحث بصري بالبصمة المحفوظة لهذه القطعة — بدون تحليل جديد */}
          <Link to={`/?similar=${id}`} className="block">
            <Button variant="outline" size="lg" className="w-full">
              <Sparkles className="size-4 ml-1" /> قطع مشابهة في المخزون
            </Button>
          </Link>
        </div>
      </div>

      <Tabs defaultValue="quotes" className="w-full">
        <TabsList className="w-full">
          <TabsTrigger value="quotes" className="flex-1">
            <Tag className="size-4 ml-1" /> الأسعار المعروضة ({quotes?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="inquiries" className="flex-1">
            <MessageCircle className="size-4 ml-1" /> الاستفسارات ({inquiries?.length ?? 0})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="quotes" className="space-y-2 mt-3">
          {quotes && quotes.length > 0 ? quotes.map((q: any) => (
            <Card key={q.id} className="p-3 flex items-center justify-between gap-3">
              <div>
                <p className="font-bold text-primary">{formatCurrency(q.price)}</p>
                <p className="text-xs text-muted-foreground">
                  {q.customer_name ?? "بدون اسم"} {q.customer_phone && `· ${q.customer_phone}`}
                </p>
                {q.notes && <p className="text-xs mt-1">{q.notes}</p>}
              </div>
              <div className="text-left text-xs text-muted-foreground">
                <p>{q.staff?.full_name}</p>
                <p>{q.branch?.name}</p>
                <p>{formatDate(q.created_at)}</p>
              </div>
            </Card>
          )) : (
            <p className="text-center text-sm text-muted-foreground py-8">لا توجد أسعار مسجلة بعد. كل سعر تعطيه لزبون سجّله هنا لمنع التخبط بين الفروع.</p>
          )}
        </TabsContent>
        <TabsContent value="inquiries" className="space-y-2 mt-3">
          {inquiries && inquiries.length > 0 ? inquiries.map((i: any) => (
            <Card key={i.id} className="p-3 flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{i.customer_name ?? "عميل"}</p>
                <p className="text-xs text-muted-foreground">{i.description}</p>
              </div>
              <div className="text-left text-xs text-muted-foreground">
                <p><User className="size-3 inline ml-1" />{i.staff?.full_name}</p>
                <p>{formatDate(i.created_at)}</p>
              </div>
            </Card>
          )) : (
            <p className="text-center text-sm text-muted-foreground py-8">لم يسأل أحد عن هذه القطعة بعد.</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Spec({ label, value, icon }: { label: string; value: any; icon?: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium flex items-center gap-1">{icon}{value ?? "—"}</p>
    </div>
  );
}

