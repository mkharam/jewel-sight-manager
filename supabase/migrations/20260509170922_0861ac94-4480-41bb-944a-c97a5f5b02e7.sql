ALTER TABLE public.products DROP CONSTRAINT products_created_by_fkey;
ALTER TABLE public.products DROP CONSTRAINT products_updated_by_fkey;
ALTER TABLE public.product_quotes DROP CONSTRAINT product_quotes_quoted_by_fkey;
ALTER TABLE public.customer_inquiries DROP CONSTRAINT customer_inquiries_created_by_fkey;
ALTER TABLE public.transfers DROP CONSTRAINT transfers_requested_by_fkey;
ALTER TABLE public.transfers DROP CONSTRAINT transfers_approved_by_fkey;
ALTER TABLE public.transfers DROP CONSTRAINT transfers_received_by_fkey;

ALTER TABLE public.products
  ADD CONSTRAINT products_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD CONSTRAINT products_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.product_quotes
  ADD CONSTRAINT product_quotes_quoted_by_fkey FOREIGN KEY (quoted_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.customer_inquiries
  ADD CONSTRAINT customer_inquiries_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.transfers
  ADD CONSTRAINT transfers_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD CONSTRAINT transfers_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD CONSTRAINT transfers_received_by_fkey FOREIGN KEY (received_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';