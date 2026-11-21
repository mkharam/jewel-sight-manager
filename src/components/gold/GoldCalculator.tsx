// حاسبة الذهب: الوزن × العيار × سعر الأونصة × سعر الدولار = قيمة الذهب الخام. ولو تكتب سعر البيع
// (للجرام أو للقطعة كلها) تطلعلك كم فوق الذهب. الأرقام تبدا بسعر اليوم، وتقدر تبدّلها (مثلاً تشوف
// شن يصير لو الدولار طلع لـ11).
import { useState, type ReactNode } from "react";
import { Calculator } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeDecimalInput } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { GRAMS_PER_OZ, PURITY, fmt, signed, type Karat } from "@/lib/goldMarket";

type RateMode = "market" | "official" | "custom";

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={cn("rounded-full border px-3 py-1.5 text-sm font-semibold tabular-nums transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-secondary")}>
      {children}
    </button>
  );
}

export default function GoldCalculator({ xau, usd, official }: { xau: number | null; usd: number | null; official: number | null }) {
  const [weight, setWeight] = useState("");
  const [karat, setKarat] = useState<Karat>("18");
  const [xauInput, setXauInput] = useState("");
  const [mode, setMode] = useState<RateMode>("market");
  const [customRate, setCustomRate] = useState("");
  const [price, setPrice] = useState("");
  const [priceIs, setPriceIs] = useState<"gram" | "piece">("gram");

  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  const w = num(weight);
  const ounce = num(xauInput) ?? xau;
  const rate = mode === "market" ? usd : mode === "official" ? official : num(customRate);
  const gram = ounce && rate ? (ounce / GRAMS_PER_OZ) * rate * PURITY[karat] : null;
  const piece = gram !== null && w ? gram * w : null;
  const p = num(price);
  const salePerGram = p && (priceIs === "gram" ? p : w ? p / w : null);
  const above = salePerGram && gram !== null ? salePerGram - gram : null;
  const abovePct = above !== null && gram ? (above / gram) * 100 : null;

  return (
    <Card className="space-y-3 p-3">
      <h2 className="flex items-center gap-2 text-lg font-bold"><Calculator className="size-5 text-primary" />حاسبة الذهب</h2>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">الوزن (جرام)</Label>
          <Input inputMode="decimal" dir="ltr" placeholder="مثلاً 10" value={weight} onChange={(e) => setWeight(normalizeDecimalInput(e.target.value))} />
        </div>
        <div>
          <Label className="text-xs">سعر الأونصة ($)</Label>
          <Input inputMode="decimal" dir="ltr" placeholder={xau ? fmt(xau) : "—"} value={xauInput} onChange={(e) => setXauInput(normalizeDecimalInput(e.target.value))} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">العيار</Label>
        <div className="flex flex-wrap gap-1.5">
          {(["18", "21", "24"] as Karat[]).map((k) => <Chip key={k} active={karat === k} onClick={() => setKarat(k)}>عيار {k}</Chip>)}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">سعر الدولار</Label>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip active={mode === "market"} onClick={() => setMode("market")}>موازي {fmt(usd, 2)}</Chip>
          <Chip active={mode === "official"} onClick={() => setMode("official")}>رسمي {fmt(official, 2)}</Chip>
          <Chip active={mode === "custom"} onClick={() => setMode("custom")}>رقم ثاني</Chip>
          {mode === "custom" && (
            <Input inputMode="decimal" dir="ltr" className="h-9 w-24" placeholder="11" autoFocus value={customRate}
              onChange={(e) => setCustomRate(normalizeDecimalInput(e.target.value))} />
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">سعر البيع (اختياري — باش تعرف كم فوق الذهب)</Label>
        <div className="flex items-center gap-1.5">
          <Input inputMode="decimal" dir="ltr" className="flex-1" placeholder={priceIs === "gram" ? "سعر الجرام" : "سعر القطعة كلها"} value={price}
            onChange={(e) => setPrice(normalizeDecimalInput(e.target.value))} />
          <Chip active={priceIs === "gram"} onClick={() => setPriceIs("gram")}>للجرام</Chip>
          <Chip active={priceIs === "piece"} onClick={() => setPriceIs("piece")}>للقطعة</Chip>
        </div>
      </div>

      <div className="space-y-1.5 rounded-xl bg-gold-soft p-3 text-sm">
        <div className="flex items-baseline justify-between gap-2">
          <span>جرام عيار {karat} خام</span>
          <span className="text-xl font-extrabold tabular-nums text-primary">{fmt(gram)} <span className="text-xs font-normal">د.ل</span></span>
        </div>
        {piece !== null && (
          <div className="flex items-baseline justify-between gap-2">
            <span>القطعة ({fmt(w, 2)} جم) خام</span>
            <span className="text-lg font-bold tabular-nums">{fmt(piece)} <span className="text-xs font-normal">د.ل</span></span>
          </div>
        )}
        {above !== null && (
          <div className="space-y-0.5 border-t border-border/60 pt-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span>البيع للجرام {fmt(salePerGram)} — فوق الذهب</span>
              <span className={cn("text-lg font-bold tabular-nums", above < 0 ? "text-destructive" : "text-primary")}>
                {signed(above)} <span className="text-xs font-normal">({signed(abovePct)}%)</span>
              </span>
            </div>
            {w ? <p className="text-xs text-muted-foreground">في القطعة كلها: {signed(above * w)} د.ل فوق قيمة الذهب.</p> : null}
            {above < 0 && <p className="text-xs text-destructive">السعر هذا تحت قيمة الذهب الخام!</p>}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          الحسبة: الأونصة {fmt(ounce)}$ ÷ 31.1 × الدولار {fmt(rate, 2)} × {karat}/24
        </p>
      </div>
    </Card>
  );
}
