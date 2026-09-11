import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Users, X } from "lucide-react";
import { formatDate } from "@/lib/constants";
import { useFillHeight } from "@/hooks/useFillHeight";
import { toast } from "sonner";

// محادثة داخلية حيّة بين كل موظفي المحل — قناة واحدة مشتركة، بث فوري عبر Realtime.
// المساعد الذكي انتقل إلى صفحة البحث (زر "اسأل المساعد") لأنه أداة بحث بالدرجة الأولى.

interface StaffMessage {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
  sender?: { full_name: string } | null;
}

export default function StaffChat() {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { ref: fillRef, height: fillHeight } = useFillHeight();

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

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
    <div className="max-w-2xl mx-auto animate-in fade-in duration-300">
      <div className="mb-3">
        <h1 className="text-xl font-bold">محادثة الموظفين</h1>
        <p className="text-sm text-muted-foreground">قناة فريق واحدة، تصل فوراً لكل من يفتح هذه الصفحة.</p>
      </div>

      <div
        ref={fillRef}
        className="flex flex-col h-[calc(100dvh-13.5rem)] sm:h-[calc(100dvh-11.5rem)]"
        style={fillHeight != null ? { height: fillHeight } : undefined}
      >
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
    </div>
  );
}
