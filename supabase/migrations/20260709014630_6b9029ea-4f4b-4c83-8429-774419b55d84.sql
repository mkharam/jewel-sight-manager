
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS code TEXT;
UPDATE public.branches SET code = CASE
  WHEN name ILIKE '%جراب%' THEN 'JRB'
  WHEN name ILIKE '%أندلس%' OR name ILIKE '%اندلس%' THEN 'AND'
  WHEN name ILIKE '%عاشور%' THEN 'BNA'
  WHEN name ILIKE '%نوفلي%' THEN 'NFL'
  WHEN name ILIKE '%قادسي%' THEN 'QDS'
  ELSE UPPER(SUBSTRING(COALESCE(name_en, name), 1, 3))
END WHERE code IS NULL;
