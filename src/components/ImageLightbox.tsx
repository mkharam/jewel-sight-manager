// عارض صور ملء الشاشة — يفتح عند الضغط على أي صورة في معرض القطعة، مع أزرار تنقّل
// بين الصور إن كان هناك أكثر من واحدة. مبنٍ كطبقة ثابتة بدل Dialog القياسي (بلا حشو
// أو حدّ أقصى للعرض) ليطابق أسلوب شاشات الكاميرا الأخرى في التطبيق.
import { useEffect } from "react";
import { X, ChevronRight, ChevronLeft } from "lucide-react";

interface Props {
  images: string[]; // روابط الصور بالترتيب
  index: number;
  onClose: () => void;
  onIndexChange: (i: number) => void;
}

export default function ImageLightbox({ images, index, onClose, onIndexChange }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onIndexChange((index + 1) % images.length);
      if (e.key === "ArrowRight") onIndexChange((index - 1 + images.length) % images.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, images.length, onClose, onIndexChange]);

  if (!images.length) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between px-4 py-3 safe-area-pt text-white">
        <span className="text-xs text-white/70">{index + 1} / {images.length}</span>
        <button onClick={onClose} className="p-2 -m-2" aria-label="إغلاق">
          <X className="size-6" />
        </button>
      </div>

      <div className="relative flex-1 flex items-center justify-center overflow-hidden">
        <img
          src={images[index]}
          alt=""
          className="max-w-full max-h-full object-contain"
          onClick={(e) => e.stopPropagation()}
        />

        {images.length > 1 && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); onIndexChange((index + 1) % images.length); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 size-10 rounded-full bg-white/10 flex items-center justify-center text-white"
              aria-label="الصورة التالية"
            >
              <ChevronRight className="size-6" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onIndexChange((index - 1 + images.length) % images.length); }}
              className="absolute left-2 top-1/2 -translate-y-1/2 size-10 rounded-full bg-white/10 flex items-center justify-center text-white"
              aria-label="الصورة السابقة"
            >
              <ChevronLeft className="size-6" />
            </button>
          </>
        )}
      </div>

      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto px-3 pb-3 safe-area-pb" onClick={(e) => e.stopPropagation()}>
          {images.map((src, i) => (
            <button
              key={i}
              onClick={() => onIndexChange(i)}
              className={`shrink-0 size-14 rounded-lg overflow-hidden border-2 ${i === index ? "border-primary" : "border-transparent"}`}
            >
              <img src={src} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
