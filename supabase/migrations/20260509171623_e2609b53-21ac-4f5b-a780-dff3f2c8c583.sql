CREATE OR REPLACE FUNCTION public.is_branch_manager(_user_id uuid, _branch_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.user_id = _user_id
      AND ur.role = 'manager'::app_role
      AND p.branch_id = _branch_id
  );
$$;

DROP POLICY IF EXISTS "auth update transfers" ON public.transfers;
CREATE POLICY "admin or branch manager update transfers"
ON public.transfers FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.is_branch_manager(auth.uid(), from_branch_id)
  OR public.is_branch_manager(auth.uid(), to_branch_id)
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.is_branch_manager(auth.uid(), from_branch_id)
  OR public.is_branch_manager(auth.uid(), to_branch_id)
);