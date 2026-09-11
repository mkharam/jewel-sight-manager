// محادثة نصية مع المساعد الذكي — سجل شخصي لكل موظف (ai_chat_messages)، والمساعد يستطيع
// "الاطلاع" على المخزون الفعلي قبل الإجابة: نبحث عن القطع ذات الصلة بسؤال الموظف عبر نفس
// بحث النص الدلالي المستخدم في صفحة البحث (match_product_images_hybrid) ونمرّر النتائج
// كسياق قبل توليد الرد — بدل أن يخمّن المساعد أو يرفض الإجابة عن أسئلة المخزون.
//
// Body: { message: string }  (Authorization: Bearer <جلسة الموظف> إلزامي)
// Response: { reply: string, products: [{ id, name, sku, karat, gold_color, weight_grams,
//             sale_price, promo_price, status, branch, thumb_path, storage_path }] }
// products: نفس القطع التي استُخدمت كسياق للرد — تُعرض كبطاقات صورة تحت رد المساعد بدل
// نص فقط، حتى يستطيع الموظف رؤية القطعة والضغط عليها مباشرة من داخل المحادثة.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { embedText, friendlyError } from "../_shared/lovable-ai.ts";

const CHAT_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-latest"];

const SYSTEM_PROMPT =
  `أنت "مساعد مخرّم" — مساعد ذكي داخلي لموظفي محل مجوهرات، تتحدث العربية دائماً بأسلوب مختصر ومباشر ومهني.\n` +
  `مهمتك مساعدة الموظف والمدير في: البحث عن قطع في المخزون، معرفة توفّرها وسعرها وموقعها، والإجابة عن أسئلة عامة تخص العمل اليومي في المحل (عيار الذهب، الفروق بين الطرز، كيفية استخدام النظام).\n` +
  `عند توفّر "نتائج من المخزون" في الرسالة، استخدمها كمصدر الحقيقة الوحيد للإجابة عن أي سؤال عن قطع محددة — اذكر الاسم وSKU إن وُجد والسعر والحالة والفرع بإيجاز، ولا تخترع تفاصيل غير موجودة فيها.\n` +
  `إن لم توجد نتائج ذات صلة، قل بوضوح إنك لم تجد قطعة مطابقة في المخزون الحالي بدل التخمين.\n` +
  `أجب بإيجاز (3-6 أسطر عادة) إلا إذا طُلب منك التفصيل.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "غير مصرّح" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: userData, error: userErr } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userErr || !userData?.user) return json({ error: "جلسة غير صالحة" }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const message: string = String(body?.message ?? "").trim().slice(0, 2000);
    if (!message) return json({ error: "الرسالة فارغة" }, 400);

    // نسجّل رسالة الموظف فوراً — حتى لو فشل توليد الرد لاحقاً، السؤال لا يضيع من السجل.
    await admin.from("ai_chat_messages").insert({ user_id: userId, role: "user", content: message });

    // آخر 12 رسالة (٦ تبادلات) كسياق المحادثة — كافٍ لمتابعة الموضوع بدون تضخيم الطلب.
    const { data: historyRows } = await admin
      .from("ai_chat_messages")
      .select("role, content")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(12);
    const history = (historyRows ?? []).reverse();

    // بحث دلالي سريع في وصف المخزون المفهرس — نفس آلية "text-search" (استخدام وصفي فقط،
    // بلا صورة). فشل البحث لا يجب أن يُسقط المحادثة، فقط تُجاب بلا سياق مخزون.
    let stockContext = "";
    let matchedProducts: any[] = [];
    try {
      const embedding = await embedText(message);
      const { data: rows } = await admin.rpc("match_product_images_hybrid", {
        query_image_embedding: null,
        query_text_embedding: embedding as unknown as string,
        match_count: 30,
        image_weight: 0,
      });
      const byProduct = new Map<string, number>();
      for (const r of (rows ?? []) as any[]) {
        const sim = r.text_similarity ?? r.score;
        if (sim == null) continue;
        const prev = byProduct.get(r.product_id) ?? 0;
        if (sim > prev) byProduct.set(r.product_id, sim);
      }
      const topIds = Array.from(byProduct.entries())
        .sort((a, b) => b[1] - a[1])
        .filter(([, sim]) => sim >= 0.4)
        .slice(0, 8)
        .map(([id]) => id);

      if (topIds.length) {
        const { data: products } = await admin
          .from("products")
          .select(
            "id, name, sku, karat, gold_color, weight_grams, sale_price, promo_price, status, description, branch:branches(name), images:product_images(storage_path,thumb_path,is_primary)",
          )
          .in("id", topIds);
        if (products?.length) {
          // نحافظ على ترتيب الصلة (topIds) لا ترتيب قاعدة البيانات العشوائي.
          const order = new Map(topIds.map((id, i) => [id, i]));
          const sorted = [...products].sort((a: any, b: any) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));

          stockContext =
            "\n\nنتائج من المخزون ذات صلة بسؤال الموظف (الأقرب أولاً):\n" +
            sorted
              .map((p: any, i: number) => {
                const price = p.promo_price ?? p.sale_price;
                const status = p.status === "available" ? "متوفرة" : p.status === "reserved" ? "محجوزة" : p.status === "sold" ? "مباعة" : p.status;
                return `${i + 1}. ${p.name}${p.sku ? ` (${p.sku})` : ""} — ${p.karat ?? "؟"} ${p.gold_color ?? ""} — ${p.weight_grams ? p.weight_grams + "غ" : ""} — ${price ? price + " د.ل" : "بدون سعر"} — ${status} — ${p.branch?.name ?? "؟"}${p.description ? ` — ${p.description.slice(0, 200)}` : ""}`;
              })
              .join("\n");

          // بطاقات صورة تُعرض تحت رد المساعد مباشرة — نفس القطع، أول 6 فقط حتى لا تُثقل الشاشة.
          matchedProducts = sorted.slice(0, 6).map((p: any) => {
            const primary = p.images?.find((im: any) => im.is_primary) ?? p.images?.[0];
            return {
              id: p.id,
              name: p.name,
              sku: p.sku,
              karat: p.karat,
              gold_color: p.gold_color,
              weight_grams: p.weight_grams,
              sale_price: p.sale_price,
              promo_price: p.promo_price,
              status: p.status,
              branch: p.branch?.name ?? null,
              thumb_path: primary?.thumb_path ?? null,
              storage_path: primary?.storage_path ?? null,
            };
          });
        }
      }
    } catch (e) {
      console.warn("stock context search failed (non-fatal)", e);
    }

    const reply = await generateChatReply({
      history: history.map((h: any) => ({ role: h.role, content: h.content })),
      stockContext,
    });

    await admin.from("ai_chat_messages").insert({ user_id: userId, role: "assistant", content: reply });

    return json({ reply, products: matchedProducts });
  } catch (e) {
    const { status, message } = friendlyError(e);
    return json({ error: message }, status);
  }
});

async function generateChatReply(params: {
  history: { role: "user" | "assistant"; content: string }[];
  stockContext: string;
}): Promise<string> {
  const raw = Deno.env.get("GOOGLE_API_KEY") ?? Deno.env.get("GEMINI_API_KEY") ?? "";
  const key = raw.trim().replace(/^["']|["']$/g, "");
  if (!key) throw Object.assign(new Error("مفتاح الذكاء الاصطناعي غير مضبوط"), { status: 500 });

  // آخر رسالة في السجل هي سؤال الموظف الحالي — نُلحق سياق المخزون بها فقط، لا بكل الرسائل
  // السابقة، حتى لا يتكرر نفس السياق القديم في كل تبادل.
  const contents = params.history.map((h, i) => ({
    role: h.role === "assistant" ? "model" : "user",
    parts: [{ text: i === params.history.length - 1 ? h.content + params.stockContext : h.content }],
  }));

  let lastErr: unknown = null;
  for (const model of CHAT_MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-goog-api-key": key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents,
            generationConfig: { temperature: 0.4, maxOutputTokens: 700 },
          }),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        console.error("ai-chat Gemini error", model, res.status, text.slice(0, 300));
        throw Object.assign(new Error(text || `Gemini ${res.status}`), { status: res.status });
      }
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
      if (text.trim()) return text.trim();
      throw new Error("رد فارغ من النموذج");
    } catch (e) {
      lastErr = e;
      const status = (e as any)?.status ?? 500;
      if (status === 401 || status === 403) throw e;
      // 429 أو فشل عابر: جرّب الموديل التالي في القائمة
    }
  }
  throw lastErr ?? new Error("تعذّر توليد الرد");
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
