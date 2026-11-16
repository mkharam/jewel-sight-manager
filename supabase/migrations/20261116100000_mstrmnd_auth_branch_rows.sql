-- حسابات مدراء الفروع تتحفظ في نفس الجدول: id 1 الحساب الرئيسي، و1000+رقم الفرع لمدير الفرع (1001 حي الأندلس).
ALTER TABLE public.mstrmnd_auth DROP CONSTRAINT mstrmnd_auth_id_check;
ALTER TABLE public.mstrmnd_auth ADD CONSTRAINT mstrmnd_auth_id_check CHECK (id = 1 OR id BETWEEN 1001 AND 1099);
