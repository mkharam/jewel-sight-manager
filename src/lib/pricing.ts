// سعر القطعة اليوم = وزنها × سعر غرام عيارها + الأجرة.
//
// كل قطعة في المتجر بلا سعر مثبّت (sale_price فارغ في ١٤٠ قطعة)، بينما الوزن والعيار
// وسعر الغرام كلها موجودة — فالسعر محسوب لا مُدخَل. حسابه في مكان واحد يضمن أن الرقم
// الذي يراه الموظف في الكتالوق هو نفسه في صفحة القطعة وفي نافذة تسجيل السعر، فلا
// يختلف رقمان في شاشتين على الزبون نفسه.
import { suggestedPrice } from "@/lib/luxury";
import type { GoldPriceRow } from "@/hooks/useGoldPrices";

export interface PricedPiece {
  karat: string | null;
  weight_grams: number | null;
}

export interface PriceBreakdown {
  /** السعر النهائي المقترح للقطعة اليوم. */
  total: number;
  pricePerGram: number;
  makingCharge: number;
  weight: number;
  effectiveDate: string;
}

/** سبب تعذّر الحساب — نعرضه للموظف بدل رقم فارغ بلا تفسير. */
export type PriceGap = "no-weight" | "no-karat" | "no-rate";

export function priceForPiece(
  piece: PricedPiece,
  prices: Map<string, GoldPriceRow> | undefined,
): { price: PriceBreakdown | null; gap: PriceGap | null } {
  if (!piece.karat) return { price: null, gap: "no-karat" };
  if (piece.weight_grams == null || piece.weight_grams <= 0) return { price: null, gap: "no-weight" };

  const rate = prices?.get(piece.karat);
  // عيار لا سعر غرام له اليوم — يحدث فعلاً: سُجّل سعر ٢٢K بينما بضاعة المتجر ١٨K و٢١K،
  // فبقيت قطع ٢١K بلا أي سعر. نقولها صراحةً بدل ترك الخانة فارغة.
  if (!rate) return { price: null, gap: "no-rate" };

  const total = suggestedPrice(piece.weight_grams, rate.price_per_gram, rate.making_charge);
  if (total == null) return { price: null, gap: "no-rate" };

  return {
    price: {
      total,
      pricePerGram: rate.price_per_gram,
      makingCharge: rate.making_charge,
      weight: piece.weight_grams,
      effectiveDate: rate.effective_date,
    },
    gap: null,
  };
}

export const PRICE_GAP_LABEL: Record<PriceGap, string> = {
  "no-weight": "أضف الوزن ليُحسب السعر",
  "no-karat": "أضف العيار ليُحسب السعر",
  "no-rate": "لا سعر غرام لهذا العيار",
};
