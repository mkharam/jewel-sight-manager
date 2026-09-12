/**
 * تحميل كونسول تشخيص (eruda) فوراً داخل نفس الجلسة الجارية — بلا اعتماد على أي تخزين
 * (localStorage/URL) لأن التطبيق المثبَّت على آيفون يبدو أن له تخزيناً منفصلاً عن سفاري
 * أحياناً، فطريقة "احفظ الفلاج وأعد الفتح" لم تصل للتطبيق المثبَّت. هذه الطريقة تعمل داخل
 * أي سياق تشغيل فوراً لأنها لا تحتاج أي شيء غير الجافاسكربت الجاري تنفيذه الآن.
 */
let loaded = false;

export function loadDebugConsole() {
  if (loaded || typeof window === "undefined") return;
  if ((window as any).eruda) {
    (window as any).eruda.show();
    return;
  }
  loaded = true;
  const s = document.createElement("script");
  s.src = "https://cdn.jsdelivr.net/npm/eruda";
  s.onload = () => (window as any).eruda?.init();
  document.body.appendChild(s);
}
