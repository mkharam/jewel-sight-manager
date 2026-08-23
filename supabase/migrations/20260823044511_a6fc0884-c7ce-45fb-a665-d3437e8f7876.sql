REVOKE ALL ON FUNCTION public.apply_reservation_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_sale_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_luxury_activity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_due_reservations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_due_reservations() TO authenticated;
