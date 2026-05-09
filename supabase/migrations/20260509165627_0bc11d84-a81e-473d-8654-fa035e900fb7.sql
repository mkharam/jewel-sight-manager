CREATE TYPE public.transfer_status AS ENUM ('pending','approved','in_transit','received','rejected','cancelled');

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TABLE public.transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name_snapshot TEXT,
  from_branch_id UUID NOT NULL REFERENCES public.branches(id),
  to_branch_id UUID NOT NULL REFERENCES public.branches(id),
  requested_by UUID NOT NULL REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  received_by UUID REFERENCES auth.users(id),
  status public.transfer_status NOT NULL DEFAULT 'pending',
  reason TEXT,
  notes TEXT,
  customer_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  CHECK (from_branch_id <> to_branch_id)
);

CREATE INDEX idx_transfers_status ON public.transfers(status);
CREATE INDEX idx_transfers_to_branch ON public.transfers(to_branch_id);
CREATE INDEX idx_transfers_from_branch ON public.transfers(from_branch_id);

ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read transfers" ON public.transfers FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth create transfers" ON public.transfers FOR INSERT TO authenticated WITH CHECK (auth.uid() = requested_by);
CREATE POLICY "auth update transfers" ON public.transfers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin delete transfers" ON public.transfers FOR DELETE TO authenticated USING (has_role(auth.uid(),'admin'::app_role));

CREATE TRIGGER trg_transfers_updated_at
BEFORE UPDATE ON public.transfers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.transfers;
ALTER TABLE public.transfers REPLICA IDENTITY FULL;