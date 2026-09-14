// عارض صور ملء الشاشة — يفتح عند الضغط على أي صورة في معرض القطعة، مع أزرار تنقّل
// بين الصور إن كان هناك أكثر من واحدة. مبنٍ كطبقة ثابتة بدل Dialog القياسي (بلا حشو
// أو حدّ أقصى للعرض) ليطابق أسلوب شاشات الكاميرا الأخرى في التطبيق.
//
// تكبير/تصغير عادي باللمس: قرص إصبعين (pinch) للتكبير الحر، ضغطتان سريعتان
// (double-tap) للتبديل بين الحجم الطبيعي وتكبير ×2.5، وسحب بإصبع واحد للتنقّل داخل
// الصورة المكبَّرة. يُستخدم Pointer Events (لا Touch Events) لأنه يعمل بنفس الكود على
// اللمس والماوس، ويُعاد الضبط تلقائياً عند تغيير الصورة أو إغلاق العارض.
import { useEffect, useRef, useState } from "react";
import { X, ChevronRight, ChevronLeft } from "lucide-react";

interface Props {
  images: string[]; // روابط الصور بالترتيب
  index: number;
  onClose: () => void;
  onIndexChange: (i: number) => void;
}

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;

export default function ImageLightbox({ images, index, onClose, onIndexChange }: Props) {
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const imgWrapRef = useRef<HTMLDivElement>(null);

  // مراجع الحالة الحيّة أثناء اللمس — refs لا state حتى لا نُعيد الرسم مع كل حركة إصبع
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ dist: number; scale: number; cx: number; cy: number; tx: number; ty: number } | null>(null);
  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const lastTapRef = useRef(0);

  const resetZoom = () => { setScale(1); setTx(0); setTy(0); };

  // إعادة الضبط عند تغيير الصورة المعروضة أو إغلاق العارض
  useEffect(() => { resetZoom(); }, [index]);

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

  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);

  const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(1, s));

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values());
      pinchStart.current = { dist: dist(a, b), scale, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, tx, ty };
      panStart.current = null;
    } else if (pointers.current.size === 1) {
      if (scale > 1) panStart.current = { x: e.clientX, y: e.clientY, tx, ty };

      // ضغطتان سريعتان (خلال 300ms) على نفس الإصبع الواحد = double-tap
      const now = Date.now();
      if (now - lastTapRef.current < 300) {
        if (scale > 1) resetZoom();
        else { setScale(DOUBLE_TAP_SCALE); setTx(0); setTy(0); }
        lastTapRef.current = 0;
      } else {
        lastTapRef.current = now;
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = Array.from(pointers.current.values());
      const ratio = dist(a, b) / (pinchStart.current.dist || 1);
      setScale(clampScale(pinchStart.current.scale * ratio));
    } else if (pointers.current.size === 1 && panStart.current) {
      setTx(panStart.current.tx + (e.clientX - panStart.current.x));
      setTy(panStart.current.ty + (e.clientY - panStart.current.y));
    }
  };

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size === 0) {
      panStart.current = null;
      if (scale <= 1) resetZoom();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between px-4 py-3 safe-area-pt text-white">
        <span className="text-xs text-white/70">{index + 1} / {images.length}</span>
        <button onClick={onClose} className="p-2 -m-2" aria-label="إغلاق">
          <X className="size-6" />
        </button>
      </div>

      <div
        ref={imgWrapRef}
        className="relative flex-1 flex items-center justify-center overflow-hidden touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      >
        <img
          src={images[index]}
          alt=""
          className="max-w-full max-h-full object-contain select-none"
          style={{
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            transition: pointers.current.size ? "none" : "transform 150ms ease-out",
            touchAction: "none",
          }}
          draggable={false}
          onClick={(e) => e.stopPropagation()}
        />

        {images.length > 1 && scale === 1 && (
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
