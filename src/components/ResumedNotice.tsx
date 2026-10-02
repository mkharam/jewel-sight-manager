// شريط «أكملنا من حيث توقفت» — يظهر حين يُستعاد نموذج لم يُحفظ بعد أن أغلق الآيفون التطبيق
// في الخلفية، مع خيار تجاهل المسودّة والبدء من جديد.
export default function ResumedNotice({ onDiscard, text = "أكملنا من حيث توقفت — ما كتبته محفوظ" }: { onDiscard: () => void; text?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-gold-soft px-3 py-2.5 text-sm">
      <span>↩︎ {text}</span>
      <button type="button" onClick={onDiscard} className="shrink-0 font-semibold text-primary underline-offset-4 hover:underline">
        البدء من جديد
      </button>
    </div>
  );
}
