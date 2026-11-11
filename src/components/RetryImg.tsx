// صورة تعيد المحاولة وحدها: على الآيفون مع شبكة ضعيفة أو عشرات الصور دفعة واحدة، يفشل تحميل
// بعضها فيظهر مربع «؟» رغم أن الملف سليم على الخادم. نعيد المحاولة (مع رابط مختلف قليلاً حتى لا
// يعيد المتصفح نفس الفشل المخزّن)، ثم نجرب الصورة الكاملة بدل المصغّرة، ولا نُظهر الأيقونة
// المكسورة أبداً — بل خلفية هادئة حتى تنجح.
import { useEffect, useState, type ImgHTMLAttributes } from "react";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "onError"> & { src: string; fallbackSrc?: string | null };

const DELAYS = [800, 2000, 5000, 10000];

export default function RetryImg({ src, fallbackSrc, style, ...rest }: Props) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setAttempt(0); setFailed(false); }, [src]);

  // المحاولات 0..n: الأصلية، ثم إعادة بنفس الرابط مع وسم، ثم الصورة الكاملة.
  const base = attempt >= 2 && fallbackSrc ? fallbackSrc : src;
  const url = attempt === 0 ? base : `${base}${base.includes("?") ? "&" : "?"}r=${attempt}`;

  return (
    <img
      {...rest}
      key={url}
      src={url}
      style={failed ? { ...style, visibility: "hidden" } : style}
      onLoad={() => setFailed(false)}
      onError={() => {
        setFailed(true);
        if (attempt < DELAYS.length) setTimeout(() => setAttempt((a) => a + 1), DELAYS[attempt]);
      }}
    />
  );
}
