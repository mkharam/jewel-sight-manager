-- ============ صفحة "المحادثة" ============
-- قسمان: (1) محادثة مع المساعد الذكي (سجل شخصي لكل موظف، يقرأ المخزون ليجاوب عن الأسئلة)
-- و(2) محادثة داخلية بين الموظفين (قناة واحدة مشتركة لكل المحل، تُبث حيّة).

-- ---------- 1) محادثة المساعد الذكي ----------
CREATE TYPE public.ai_chat_role AS ENUM ('user', 'assistant');

CREATE TABLE public.ai_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role public.ai_chat_role NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.ai_chat_messages TO authenticated;
GRANT ALL ON public.ai_chat_messages TO service_role;
ALTER TABLE public.ai_chat_messages ENABLE ROW LEVEL SECURITY;
-- كل موظف يرى ويكتب سجل محادثته الخاصة فقط — لا اطّلاع على أسئلة الآخرين للمساعد.
CREATE POLICY "own ai chat read" ON public.ai_chat_messages FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own ai chat insert" ON public.ai_chat_messages FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "own ai chat delete" ON public.ai_chat_messages FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE INDEX idx_ai_chat_user_time ON public.ai_chat_messages(user_id, created_at);

-- ---------- 2) محادثة الموظفين ----------
CREATE TABLE public.staff_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.staff_messages TO authenticated;
GRANT ALL ON public.staff_messages TO service_role;
ALTER TABLE public.staff_messages ENABLE ROW LEVEL SECURITY;
-- قناة واحدة مشتركة يراها كل الموظفين المسجّلين — تشبه استفسارات العملاء (بث مفتوح للفريق).
CREATE POLICY "auth read staff chat" ON public.staff_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert staff chat" ON public.staff_messages FOR INSERT TO authenticated WITH CHECK (sender_id = auth.uid());
-- حذف رسالة: صاحبها فقط، أو المدير العام لأغراض الإشراف.
CREATE POLICY "sender or admin delete staff chat" ON public.staff_messages FOR DELETE TO authenticated
  USING (sender_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));
CREATE INDEX idx_staff_messages_time ON public.staff_messages(created_at);

ALTER TABLE public.staff_messages REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_messages;
