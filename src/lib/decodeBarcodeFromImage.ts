// يقرأ باركود من ملف صورة مرفوع (بدل الكاميرا الحية) — يُستخدم كخيار احتياطي في صفحة
// "الإضافة المباشرة" عندما تفشل القراءة الحية أو عندما يكون الباركود مُصوَّراً مسبقاً.
// zxing-cpp (راجع tagReader.ts) يجرّب الزوايا والتصغير وحده، فالصور الجانبية تنقرا.
import { readTag } from "@/lib/tagReader";

export async function decodeBarcodeFromFile(file: File): Promise<string | null> {
  return readTag(file);
}
