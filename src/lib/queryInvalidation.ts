// مصدر واحد لتحديد "إيش يتحدّث لما تتغيّر حالة قطعة" — بيع، حجز، تغيير حالة، حذف.
//
// السبب: كل شاشة كانت تُبطل استعلاماتها هي فقط، فبيع قطعة من صفحة تفاصيلها كان يحدّث
// تلك الصفحة وحدها بينما الكتالوج يظل يعرضها "متوفرة"، وبطاقة "مبيعاتي" تظل على رقمها
// القديم، وتنبيه نقص المخزون لا ينتبه أن قطعة خرجت — ولا شيء من هذا يتصحّح إلا بإعادة
// تحميل الصفحة يدوياً. تجميع القائمة هنا يعني أن أي شاشة جديدة تُضاف لاحقاً تحتاج سطراً
// واحداً في هذا الملف بدل تتبّع كل نقطة بيع/حجز في التطبيق.
//
// ملاحظة: invalidateQueries يطابق بالبادئة، فـ["products"] تشمل ["products", filters, ...]
// تلقائياً — لا حاجة لتكرار المفاتيح الكاملة هنا.
import type { QueryClient } from "@tanstack/react-query";

/**
 * تُستدعى بعد أي تغيير يُخرج قطعة من المخزون المتاح أو يُعيدها إليه (بيع/حجز/إرجاع/حذف).
 * لا تشمل تعديل بيانات قطعة واحدة (اسم/وصف) — لذلك يكفي إبطال ["product", id].
 */
export function invalidateInventoryAndSales(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["products"] });          // الكتالوج/البحث
  qc.invalidateQueries({ queryKey: ["admin-products"] });    // جدول إدارة القطع
  qc.invalidateQueries({ queryKey: ["my-sales"] });          // بطاقة "مبيعاتي" للموظف
  qc.invalidateQueries({ queryKey: ["sales-leaderboard"] }); // لوحة صدارة المبيعات
  qc.invalidateQueries({ queryKey: ["category-stock-levels"] }); // تنبيه نقص المخزون
}
