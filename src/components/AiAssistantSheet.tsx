import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Bot, Send, Sparkles } from "lucide-react";
import { formatCurrency, getThumbUrl } from "@/lib/constants";
import { toast } from "sonner";

// مساعد ذكي مدمج في صفحة البحث — يبحث في المخزون الفعلي ويعرض القطع المطابقة كبطاقات
// صورة داخل المحادثة نفسها، لا نصاً فقط. راجع supabase/functions/ai-chat.

const QUICK_PROMPTS = [
  "عندنا خواتم ألماس متوفرة الآن؟",
  "ابحث عن قطع بطراز فان كليف",
  "وريني أطقم فيها أحجار خضراء",
];

interface MatchedProduct {
  id: string;
  name: string;
  sku: string | null;
  karat: string | null;
  gold_color: string | null;
  weight_grams: number | null;
  sale_price: number | null;
  promo_price: number | null;
  status: string;
  branch: string | null;
  thumb_path: string | null;
  storage_path: string | null;
}

interface AiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  products?: MatchedProduct[];
}

const STATUS_LABEL: Record<string, string> = {
  available: "متوفرة",
  reserved: "محجوزة",
  sold: "مباعة",
};

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-3.5 py-2.5">
      <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.3s]" />
      <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.15s]" />
      <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce" />
    </div>
  );
}

function ProductChip({ p }: { p: MatchedProduct }) {
  const url = getThumbUrl(p);
  const price = p.promo_price ?? p.sale_price;
  return (
    <Link
      to={`/products/${p.id}`}
      className="w-28 shrink-0 rounded-lg overflow-hidden border border-border/60 bg-card hover:shadow-card hover:-translate-y-0.5 transition-all"
    >
      <div className="aspect-square bg-gold-soft">
        {url ? (
          <img src={url} alt={p.name} className="w-full h-full object-contain" loading="lazy" decoding="async" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <Sparkles className="size-5 opacity-30" />
          </div>
        )}
      </div>
      <div className="p-1.5 space-y-0.5">
        <p className="text-[10px] font-semibold line-clamp-1">{p.name}</p>
        <p className="text-[10px] font-bold text-primary">{formatCurrency(price)}</p>
        <p className="text-[9px] text-muted-foreground">{STATUS_LABEL[p.status] ?? p.status}</p>
      </div>
    </Link>
  );
}

export default function AiAssistantSheet() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [optimistic, setOptimistic] = useState<AiMessage[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

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
    enabled: !!user && open,
  });

  const messages = [...history, ...optimistic];

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, sending, open]);

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
      const products: MatchedProduct[] = (data as any)?.products ?? [];
      // نلحق نتائج القطع بردّ المساعد محلياً فقط (لا تُخزَّن في السجل) — تُعرض فوراً كبطاقات صور.
      setOptimistic([tempUser, { id: `tmp-a-${Date.now()}`, role: "assistant", content: (data as any).reply, created_at: new Date().toISOString(), products }]);
      qc.invalidateQueries({ queryKey: ["ai-chat-history", user?.id] });
      // نُبقي الرد المؤقت (مع الصور) بدل استبداله فوراً بسجل قاعدة البيانات الخالي من الصور.
    } catch (e: any) {
      setOptimistic([]);
      setText(msg);
      toast.error(e.message ?? "تعذّر إرسال السؤال، حاول مجدداً");
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="lg" className="h-12" title="اسأل المساعد الذكي">
          <Bot className="size-4 ml-1" />
          <span className="hidden sm:inline">اسأل المساعد</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="h-[85dvh] flex flex-col p-0">
        <SheetHeader className="p-4 pb-2 border-b border-border/60">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" /> مساعد مخرّم الذكي
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
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
              <p className="text-sm text-muted-foreground max-w-xs">اسأل عن أي قطعة في المخزون، توفّرها، سعرها، أو شكلها — وسترى القطع المطابقة فوراً.</p>
              <div className="flex flex-wrap gap-2 justify-center max-w-sm">
                {QUICK_PROMPTS.map((p) => (
                  <button key={p} onClick={() => send(p)} className="text-xs px-3 py-1.5 rounded-full bg-gold-soft border border-primary/20 text-primary hover:bg-primary/10 transition-colors">
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={m.id} style={{ animationDelay: `${Math.min(i, 4) * 40}ms` }} className={`animate-in fade-in slide-in-from-bottom-2 duration-300 flex flex-col ${m.role === "user" ? "items-start" : "items-end"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap leading-relaxed shadow-sm ${
                    m.role === "user" ? "bg-secondary text-foreground rounded-bl-sm" : "bg-gold-gradient text-primary-foreground rounded-br-sm"
                  }`}
                >
                  {m.content}
                </div>
                {!!m.products?.length && (
                  <div className="flex gap-2 overflow-x-auto max-w-full pt-2 pb-1 -mx-1 px-1">
                    {m.products.map((p) => <ProductChip key={p.id} p={p} />)}
                  </div>
                )}
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

        <div className="flex items-end gap-2 p-3 border-t border-border/60 safe-area-pb">
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
            className="min-h-11 max-h-28 resize-none"
          />
          <Button type="button" onClick={() => send()} disabled={!text.trim() || sending} size="icon" className="shrink-0 bg-gold-gradient text-primary-foreground shadow-gold">
            <Send className="size-4" />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
