// إطار تصويب بارز فوق عرض الكاميرا: زوايا سميكة بلون الذهب + تعتيم خارج المنطقة —
// يوضّح بلا لبس أين يجب وضع الباركود، ويبقى مرئياً بوضوح فوق أي خلفية (خزائن عرض
// بيضاء لامعة، إضاءة قوية...). يتحول للأخضر فور اكتشاف باركود داخله.
import { SCAN_BOX } from "@/lib/useBoxedBarcodeScanner";

export { SCAN_BOX };

export default function ScanBoxOverlay({ active }: { active: boolean }) {
  const color = active ? "#22c55e" : "#f5c518"; // أخضر عند الاكتشاف، ذهبي أثناء الانتظار
  const corner = "absolute size-8 border-[5px]";

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: "0 0 0 999px rgba(0,0,0,0.5)" }}>
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ width: `${SCAN_BOX.widthPct * 100}%`, height: `${SCAN_BOX.heightPct * 100}%` }}
      >
        {/* حدّ خفيف متصل بين الزوايا حتى يتضح شكل المستطيل كاملاً */}
        <div className="absolute inset-0 rounded-lg" style={{ border: `2px solid ${color}66` }} />
        <div className={`${corner} top-0 right-0 rounded-tr-lg border-b-0 border-l-0`} style={{ borderColor: color }} />
        <div className={`${corner} top-0 left-0 rounded-tl-lg border-b-0 border-r-0`} style={{ borderColor: color }} />
        <div className={`${corner} bottom-0 right-0 rounded-br-lg border-t-0 border-l-0`} style={{ borderColor: color }} />
        <div className={`${corner} bottom-0 left-0 rounded-bl-lg border-t-0 border-r-0`} style={{ borderColor: color }} />
      </div>
    </div>
  );
}
