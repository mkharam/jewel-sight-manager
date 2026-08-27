ALTER TYPE public.product_status ADD VALUE IF NOT EXISTS 'in_repair';
ALTER TYPE public.product_status ADD VALUE IF NOT EXISTS 'stock_discrepancy';
ALTER TYPE public.product_status ADD VALUE IF NOT EXISTS 'archived';