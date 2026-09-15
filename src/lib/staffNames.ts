// أسماء الموظفين في القوائم.
//
// ضمّ profiles مباشرةً في الاستعلام (‎staff:profiles!fk(full_name)‎) يعمل للمدير العام
// ويعود فارغاً للموظف، لأن سياسة profiles تسمح له بقراءة سطره وحده. فيظهر «سجّله —»
// بلا اسم. نجلب الأسماء من staff_directory في استعلام ثانٍ صغير بدل الضمّ.
import { supabase } from "@/integrations/supabase/client";

/**
 * يُلحق ‎{ full_name }‎ بكل صف تحت المفتاح `as`، مأخوذاً من عمود المُعرّف `idKey`.
 * يعدّل الصفوف في مكانها ويُعيدها تسهيلاً للاستعمال داخل queryFn.
 */
export async function attachStaffNames<T extends Record<string, any>>(
  rows: T[],
  idKey: keyof T & string,
  as: string,
): Promise<T[]> {
  const ids = Array.from(new Set(rows.map((r) => r[idKey]).filter(Boolean))) as string[];
  if (ids.length === 0) return rows;
  const { data } = await supabase.from("staff_directory").select("id, full_name").in("id", ids);
  const map = new Map((data ?? []).map((p: any) => [p.id, p.full_name]));
  for (const row of rows) {
    const name = row[idKey] ? map.get(row[idKey]) : null;
    (row as any)[as] = name ? { full_name: name } : null;
  }
  return rows;
}
