-- المشرف يرى تذاكر الصيانة لفرعه وحده في صفحة «الصيانة»؛ المدير العام يرى الكل
-- (سياسته قائمة). القراءة فقط — الكتابة تبقى حصراً عبر repair-api بـ service_role.
-- المشرف بلا فرع مرتبط لا يرى شيئاً (branch_id = NULL لا يساوي أي فرع).
CREATE POLICY "Managers read own-branch repair tickets" ON public.repair_tickets
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'manager')
    AND branch_id = (SELECT p.branch_id FROM public.profiles p WHERE p.id = auth.uid())
  );
