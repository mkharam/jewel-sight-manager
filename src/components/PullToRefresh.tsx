// اسحب لتحت من أعلى الصفحة للتحديث — التطبيق المثبّت على الآيفون ما فيهش هذا، فكان الموظف
// يقفل التطبيق ويفتحه باش يشوف نسخة جديدة. إعادة التحميل تجيب آخر نسخة لأن الـSW يجيب
// الصفحة من الشبكة أولاً (public/sw.js). لو فيه رفع صور شغّال ما نعيدش التحميل (يقطع الرفع)،
// نحدّث البيانات بس.
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { uploadQueue } from "@/lib/uploadQueue";

const TRIGGER = 80; // بكسل سحب قبل ما يتحدّث
const MAX = 120;

// يبدأ السحب فقط لو الصفحة وكل ما تحت الإصبع في أعلى نقطة، وما فيش نافذة مفتوحة.
function canStart(target: EventTarget | null) {
  if (window.scrollY > 0) return false;
  if (document.querySelector('[role="dialog"]')) return false;
  const t = target as HTMLElement | null;
  if (t?.closest?.("video, canvas, [data-no-pull]")) return false;
  for (let el = t; el && el !== document.body; el = el.parentElement) {
    if (el.scrollTop > 0) return false;
  }
  return true;
}

export default function PullToRefresh() {
  const qc = useQueryClient();
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef<number | null>(null);
  const pullRef = useRef(0);

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      start.current = e.touches.length === 1 && canStart(e.target) ? e.touches[0].clientY : null;
    };
    const onMove = (e: TouchEvent) => {
      if (start.current == null) return;
      const dy = e.touches[0].clientY - start.current;
      if (dy <= 0 || window.scrollY > 0) { pullRef.current = 0; setPull(0); return; }
      // مقاومة: السحب يثقل كل ما نزل أكثر.
      const d = Math.min(MAX, dy * 0.5);
      pullRef.current = d;
      setPull(d);
    };
    const onEnd = async () => {
      const d = pullRef.current;
      start.current = null;
      pullRef.current = 0;
      if (d < TRIGGER) { setPull(0); return; }
      setBusy(true);
      setPull(TRIGGER * 0.6);
      const uploading = uploadQueue.getItems().some((i) => i.status !== "done" && i.status !== "error");
      if (!uploading) { window.location.reload(); return; }
      await qc.invalidateQueries();
      setBusy(false);
      setPull(0);
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [qc]);

  if (!pull && !busy) return null;
  const ready = pull >= TRIGGER;
  return (
    <div
      className="md:hidden fixed left-1/2 z-50 -translate-x-1/2 rounded-full bg-card shadow-card border border-border size-11 flex items-center justify-center"
      style={{ top: `calc(env(safe-area-inset-top) + ${8 + pull * 0.6}px)`, opacity: Math.min(1, pull / 40) }}
      aria-live="polite"
      aria-label={busy ? "جارٍ التحديث" : ready ? "اترك للتحديث" : "اسحب للتحديث"}
    >
      <RefreshCw
        className={`size-5 text-primary ${busy ? "animate-spin" : ""}`}
        style={busy ? undefined : { transform: `rotate(${pull * 3}deg)` }}
      />
    </div>
  );
}
