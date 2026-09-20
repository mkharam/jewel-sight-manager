-- نسخة مقروءة فقط من تذاكر الصيانة (تطبيق Goldsystem) لعرضها في صفحة المدير.
-- المصدر الوحيد للحقيقة هو قاعدة الصيانة؛ تُكتب هنا فقط عبر دالة repair-api
-- (service_role) عند كل تغيير على التذكرة، ولا يكتبها أي مستخدم من المتصفح.
CREATE TABLE public.repair_tickets (
  id UUID PRIMARY KEY,                       -- معرّف التذكرة في قاعدة الصيانة
  ticket_number TEXT NOT NULL UNIQUE,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name TEXT,
  customer_phone TEXT,
  received_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  received_by_name TEXT,
  assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_to_name TEXT,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  item_code TEXT,
  item_name TEXT NOT NULL,
  item_type TEXT,
  karat TEXT,
  weight_in_grams NUMERIC(10,3),
  weight_out_grams NUMERIC(10,3),
  problem_description TEXT,
  work_done TEXT,
  estimated_cost NUMERIC(12,2),
  final_cost NUMERIC(12,2),
  status TEXT NOT NULL CHECK (status IN ('received','in_progress','ready','delivered','cancelled')),
  received_at TIMESTAMPTZ NOT NULL,
  promised_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX repair_tickets_branch_idx ON public.repair_tickets(branch_id);
CREATE INDEX repair_tickets_customer_idx ON public.repair_tickets(customer_id);
CREATE INDEX repair_tickets_received_by_idx ON public.repair_tickets(received_by);
CREATE INDEX repair_tickets_assigned_to_idx ON public.repair_tickets(assigned_to);
CREATE INDEX repair_tickets_product_idx ON public.repair_tickets(product_id);
CREATE INDEX repair_tickets_status_idx ON public.repair_tickets(status, received_at DESC);

ALTER TABLE public.repair_tickets ENABLE ROW LEVEL SECURITY;

-- المديرون فقط يقرؤون. لا سياسات كتابة: الكتابة عبر service_role حصراً.
CREATE POLICY "Admins read repair tickets" ON public.repair_tickets
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
