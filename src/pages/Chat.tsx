import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bot, Send, Sparkles, Trash2, Users, X } from "lucide-react";
import { formatDate } from "@/lib/constants";
import { toast } from "sonner";

// صفحة "المحادثة" — قسمان: مساعد ذكي شخصي لكل موظف (يقرأ المخزون قبل الإجابة)، ومحادثة
// داخلية حيّة بين كل موظفي المحل (قناة واحدة مشتركة، بث فوري عبر Realtime).

const QUICK_PROMPTS = [
  "عندنا خواتم ألماس متوفرة الآن؟",
  "ابحث عن قطع بطراز فان كليف",
  "شن الفرق بين عيار 18 و21؟",
  "وريني أطقم فيها أحجار خضراء",
];

interface AiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

interface StaffMessage {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
  sender?: { full_name: string } | null;
}

function useAutoScroll(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [dep]);
  return ref;
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-3.5 py-2.5">
      <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.3s]" />
      <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.15s]" />
      <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce" />
    </div>
  );
}

function AssistantTab() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  // ردّ المساعد الجاري توليده يُعرض فوراً محلياً بدل انتظار جولة قاعدة البيانات كاملة.
  const [optimistic, setOptimistic] = useState<AiMessage[]>([]);

  const { data: history = [], isLoading } = useQuery({
    queryKey: ["ai-chat-history", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("ai_chat_messages")
        .select("id, role, content, created_at")
        .order("created_at", { ascending: true })
        .limit(200);
      return (data ?? []) as AiMessage[];
    },
    enabled: !!user,
  });

  const messages = [...history, ...optimistic];
  const bottomRef = useAutoScroll(messages.length + (sending ? 1 : 0));

  const send = async (value?: string) => {
    const msg = (value ?? text).trim();
    if (!msg || sending) return;
    setText("");
    setSending(true);
    const tempUser: AiMessage = { id: `tmp-${Date.now()}`, role: "user", content: msg, created_at: new Date().toISOString() };
    setOptimistic([tempUser]);
    try {
      const { data, error } = await supabase.functions.invoke("ai-chat", { body: { message: msg } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setOptimistic([]);
      qc.invalidateQueries({ queryKey: ["ai-chat-history", user?.id] });
    } catch (e: any) {
      setOptimistic([]);
      setText(msg);
      toast.error(e.message ?? "تعذّر إرسال السؤال، حاول مجدداً");
    } finally {
      setSending(false);
    }
  };

  const clearHistory = async () => {
    if (!user) return;
    await supabase.from("ai_chat_messages").delete().eq("user_id", user.id);
    qc.invalidateQueries({ queryKey: ["ai-chat-history", user.id] });
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-13.5rem)] sm:h-[calc(100dvh-12rem)]">
      <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-3 py-2">
        {isLoading ? (
          <div className="space-y-3">
            <div className="h-14 w-2/3 rounded-2xl skeleton" />
            <div className="h-10 w-1/2 rounded-2xl skeleton mr-auto" style={{ animationDelay: "150ms" }} />
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-4 py-10 animate-in fade-in duration-500">
            <div className="size-16 rounded-2xl bg-gold-gradient shadow-gold flex items-center justify-center">
              <Sparkles className="size-8 text-primary-foreground" />
            </div>
            <div>
              <p className="font-bold text-lg">مساعد مخرّم الذكي</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                اسأل عن أي قطعة في المخزون، توفّرها، سعرها، أو أي سؤال عن العمل اليومي.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center max-w-sm">
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => send(p)}
                  className="text-xs px-3 py-1.5 rounded-full bg-gold-soft border border-primary/20 text-primary hover:bg-primary/10 transition-colors"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={m.id}
              style={{ animationDelay: `${Math.min(i, 4) * 40}ms` }}
              className={`flex animate-in fade-in slide-in-from-bottom-2 duration-300 ${m.role === "user" ? "justify-start" : "justify-end"}`}
            >
              <div
                className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap leading-relaxed shadow-sm ${
                  m.role === "user"
                    ? "bg-secondary text-foreground rounded-bl-sm"
                    : "bg-gold-gradient text-primary-foreground rounded-br-sm"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))
        )}
        {sending && (
          <div className="flex justify-end animate-in fade-in duration-200">
            <div className="bg-gold-gradient/90 rounded-2xl rounded-br-sm shadow-sm">
              <TypingDots />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-end gap-2 pt-2 border-t border-border/60">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="اسأل المساعد عن قطعة أو سؤال عملي..."
          rows={1}
          className="min-h-11 max-h-32 resize-none"
        />
        {history.length > 0 && (
          <Button type="button" variant="ghost" size="icon" onClick={clearHistory} title="مسح المحادثة" className="shrink-0 text-muted-foreground">
            <Trash2 className="size-4" />
          </Button>
        )}
        <Button type="button" onClick={() => send()} disabled={!text.trim() || sending} size="icon" className="shrink-0 bg-gold-gradient text-primary-foreground shadow-gold">
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function StaffChatTab() {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["staff-chat"],
    queryFn: async () => {
      const { data } = await supabase
        .from("staff_messages")
        .select("id, sender_id, content, created_at, sender:profiles!staff_messages_sender_id_fkey(full_name)")
        .order("created_at", { ascending: true })
        .limit(200);
      return (data ?? []) as unknown as StaffMessage[];
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel("staff-chat-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "staff_messages" }, () => {
        qc.invalidateQueries({ queryKey: ["staff-chat"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const bottomRef = useAutoScroll(messages.length);

  const send = async () => {
    const msg = text.trim();
    if (!msg || !user || sending) return;
    setText("");
    setSending(true);
    try {
      const { error } = await supabase.from("staff_messages").insert({ sender_id: user.id, content: msg });
      if (error) throw error;
    } catch (e: any) {
      setText(msg);
      toast.error(e.message ?? "تعذّر إرسال الرسالة");
    } finally {
      setSending(false);
    }
  };

  const remove = async (id: string) => {
    await supabase.from("staff_messages").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["staff-chat"] });
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-13.5rem)] sm:h-[calc(100dvh-12rem)]">
      <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-2.5 py-2">
        {isLoading ? (
          <div className="space-y-3">
            <div className="h-12 w-2/3 rounded-2xl skeleton" />
            <div className="h-12 w-1/2 rounded-2xl skeleton mr-auto" style={{ animationDelay: "150ms" }} />
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-10 animate-in fade-in duration-500">
            <div className="size-16 rounded-2xl bg-secondary flex items-center justify-center">
              <Users className="size-8 text-muted-foreground" />
            </div>
            <div>
              <p className="font-bold text-lg">محادثة الفريق</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">أول رسالة تبدأ محادثة الموظفين — تصل فوراً لكل من يفتح هذه الصفحة.</p>
            </div>
          </div>
        ) : (
          messages.map((m, i) => {
            const mine = m.sender_id === user?.id;
            return (
              <div
                key={m.id}
                style={{ animationDelay: `${Math.min(i, 4) * 30}ms` }}
                className={`group flex animate-in fade-in slide-in-from-bottom-1 duration-300 ${mine ? "justify-end" : "justify-start"}`}
              >
                <div className={`flex items-end gap-1.5 max-w-[85%] sm:max-w-[65%] ${mine ? "flex-row-reverse" : ""}`}>
                  <div
                    className={`rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap leading-relaxed shadow-sm ${
                      mine ? "bg-primary text-primary-foreground rounded-bl-sm" : "bg-secondary text-foreground rounded-br-sm"
                    }`}
                  >
                    {!mine && <p className="text-[11px] font-bold text-primary mb-0.5">{m.sender?.full_name ?? "موظف"}</p>}
                    {m.content}
                    <p className={`text-[10px] mt-1 ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{formatDate(m.created_at)}</p>
                  </div>
                  {mine && (
                    <button
                      onClick={() => remove(m.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0"
                      title="حذف"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-end gap-2 pt-2 border-t border-border/60">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={`اكتب رسالة للفريق باسم ${profile?.full_name ?? "..."}`}
          rows={1}
          className="min-h-11 max-h-32 resize-none"
        />
        <Button type="button" onClick={send} disabled={!text.trim() || sending} size="icon" className="shrink-0">
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export default function Chat() {
  return (
    <div className="max-w-2xl mx-auto animate-in fade-in duration-300">
      <div className="mb-3">
        <h1 className="text-xl font-bold">المحادثة</h1>
        <p className="text-sm text-muted-foreground">اسأل المساعد الذكي عن المخزون، أو تحدّث مع فريق العمل مباشرة.</p>
      </div>
      <Tabs defaultValue="ai" dir="rtl" className="w-full">
        <TabsList className="grid grid-cols-2 w-full mb-3">
          <TabsTrigger value="ai" className="gap-1.5">
            <Bot className="size-4" /> المساعد الذكي
          </TabsTrigger>
          <TabsTrigger value="staff" className="gap-1.5">
            <Users className="size-4" /> محادثة الموظفين
          </TabsTrigger>
        </TabsList>
        <TabsContent value="ai" className="mt-0">
          <AssistantTab />
        </TabsContent>
        <TabsContent value="staff" className="mt-0">
          <StaffChatTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
