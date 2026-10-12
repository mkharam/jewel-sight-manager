// "إرسال للزبون": صورة القطعة وتفاصيلها إلى نافذة المشاركة في الآيفون (واتساب، رسائل...) مباشرة
// من صفحة القطعة، بدل أن يصوّر الموظف الشاشة ثم يكتب الوزن والعيار يدوياً في الواتساب.
import { useEffect, useState } from "react";
import { formatCurrency, formatWeight } from "@/lib/constants";

export type SharePieceInfo = {
  name: string;
  sku?: string | null;
  karat?: string | null;
  colorLabel?: string | null;
  weight_grams?: number | null;
  /** يُمرَّر فقط إن كان الموظف يرى السعر نفسه في الصفحة — لا نُرسل للزبون ما لا يراه الموظف. */
  price?: number | null;
};

export function pieceShareText(p: SharePieceInfo): string {
  return [
    p.name,
    [p.karat, p.colorLabel].filter(Boolean).join(" · "),
    p.weight_grams != null ? `الوزن: ${formatWeight(p.weight_grams)}` : "",
    p.price != null ? `السعر: ${formatCurrency(p.price)}` : "",
    p.sku ? `رقم القطعة: ${p.sku}` : "",
  ].filter(Boolean).join("\n");
}

/**
 * يجهّز ملف الصورة مسبقاً عند فتح الصفحة: Safari على الآيفون يرفض navigator.share إن
 * لم يُستدعَ مباشرة بعد الضغطة، فتحميل الصورة *بعد* الضغط كان سيُفشل المشاركة.
 */
export function useShareImageFile(url: string | null | undefined): File | null {
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
    setFile(null);
    if (!url) return;
    let cancelled = false;
    fetch(url)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (!cancelled && b) setFile(new File([b], "piece.jpg", { type: b.type || "image/jpeg" }));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [url]);
  return file;
}

/** "shared" نجحت، "cancelled" أغلق الموظف النافذة، "copied" لا مشاركة (كمبيوتر) فنُسخ النص. */
export async function sharePiece(text: string, file: File | null): Promise<"shared" | "cancelled" | "copied"> {
  if (navigator.share) {
    try {
      if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text });
      else await navigator.share({ text });
      return "shared";
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return "cancelled";
    }
  }
  await navigator.clipboard?.writeText(text).catch(() => {});
  return "copied";
}
