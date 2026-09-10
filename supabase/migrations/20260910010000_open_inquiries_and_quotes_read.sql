-- استكمال معايرة الصلاحيات: طلب سابق بأن يرى المشرف والموظف "بضاعة المحلات التانية
-- والاستفسارات" عبر كل الفروع — طُبِّق على products لكن نُسي على customer_inquiries،
-- وأيضاً product_quotes (الأسعار المعروضة) التي تظهر الآن في صفحة الاستفسارات أيضاً.
-- القراءة فقط تُفتح؛ التعديل/الحذف يبقيان محدودين كما كانا (فرع المستخدم أو المدير).

drop policy if exists "read inquiries scoped to branch or admin" on public.customer_inquiries;
create policy "read inquiries for any authenticated user"
  on public.customer_inquiries for select
  to authenticated
  using (true);

drop policy if exists "read quotes scoped to branch or admin" on public.product_quotes;
create policy "read quotes for any authenticated user"
  on public.product_quotes for select
  to authenticated
  using (true);
