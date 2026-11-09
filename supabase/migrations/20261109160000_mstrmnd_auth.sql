-- دخول الربط مع MSTRMND: رمز التجديد (refresh token) لحساب الماسح «ربط تطبيق مخرّم».
-- الدخول نفسه يطلب reCAPTCHA، فصاحب المحل يدخل مرة بيده وينسخ رمز التجديد للسر MSTRMND_REFRESH_TOKEN،
-- والدالة mstrmnd-link تجدده وتحفظ الجديد هنا (MSTRMND يبدّل رمز التجديد مع كل تجديد أحياناً).
-- الجدول للخادم بس: RLS مفعّل بلا سياسات، فلا المتصفح ولا الموظفين يقروه.
create table if not exists public.mstrmnd_auth (
  id int primary key default 1 check (id = 1),
  refresh_token text,
  access_token text,
  access_expires_at timestamptz,
  seed_hash text,            -- بصمة السر اللي جا منه الرمز، باش لو تبدّل السر نبداو منه من جديد
  last_error text,
  updated_at timestamptz not null default now()
);
alter table public.mstrmnd_auth enable row level security;
revoke all on public.mstrmnd_auth from anon, authenticated;
