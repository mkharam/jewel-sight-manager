// الكمية المتوفرة من القطعة (خواتم وأساور متطابقة تُسجَّل مرة واحدة بعدد).
// المدير/المشرف يعدّلها بزرّي − و+ مباشرة. لا تنزل يدوياً تحت 1: النفاد يحدث بالبيع وحده حتى
// يبقى لكل قطعة خرجت سجل بيع. "+" على قطعة نفدت (مبيعة) يعيدها للمخزون متوفرة.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Minus, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { invalidateInventoryAndSales } from "@/lib/queryInvalidation";
import { toast } from "sonner";

export default function QuantityControl({
  productId,
  quantity,
  status,
  canEdit,
}: {
  productId: string;
  quantity: number;
  status: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const setQuantity = async (next: number) => {
    if (next < 1 || saving) return;
    setSaving(true);
    const patch: { quantity: number; status?: "available" } = { quantity: next };
    if (status === "sold") patch.status = "available";
    const { error } = await supabase.from("products").update(patch).eq("id", productId);
    setSaving(false);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["product", productId] });
    invalidateInventoryAndSales(qc);
  };

  return (
    <div>
      <p className="text-xs text-muted-foreground">الكمية</p>
      {canEdit ? (
        <div className="flex items-center gap-2 mt-0.5">
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="size-8"
            onClick={() => setQuantity(quantity - 1)}
            disabled={saving || quantity <= 1}
            aria-label="إنقاص الكمية"
          >
            <Minus className="size-4" />
          </Button>
          <span className="min-w-6 text-center font-bold tabular-nums">
            {saving ? <Loader2 className="size-4 animate-spin inline" /> : quantity}
          </span>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="size-8"
            onClick={() => setQuantity(quantity + 1)}
            disabled={saving}
            aria-label="زيادة الكمية"
          >
            <Plus className="size-4" />
          </Button>
        </div>
      ) : (
        <p className="font-medium">{quantity}</p>
      )}
    </div>
  );
}
