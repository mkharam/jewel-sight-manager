-- store phone on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NULLIF(NEW.raw_user_meta_data->>'phone', '')
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'employee');
  RETURN NEW;
END; $function$;

-- helper: does the signed-in user have a branch assigned?
CREATE OR REPLACE FUNCTION public.has_branch(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id AND branch_id IS NOT NULL AND COALESCE(is_active, true)
  )
$$;

GRANT EXECUTE ON FUNCTION public.has_branch(uuid) TO authenticated;

-- products visible only to admins/managers or employees assigned to a branch
DROP POLICY IF EXISTS "auth read products" ON public.products;
CREATE POLICY "read products when assigned" ON public.products
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'manager')
  OR public.has_branch(auth.uid())
);