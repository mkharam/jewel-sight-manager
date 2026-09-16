// واجهة القراءة الخاصة بتطبيق الصيانة (repair app) — تطبيق منفصل بقاعدة بياناته الخاصة.
// لا نمنحه مفاتيح Supabase الخاصة بالمخزون ولا وصولاً مباشراً للجداول؛ بدل ذلك يستدعي
// هذه الدالة بمفتاح خدمة مشترك (REPAIR_API_KEY) فتُرجع له الحد الأدنى من الحقول التي
// يحتاجها: الفروع، بحث الزبون بالهاتف، وبحث القطعة بالكود لتعبئة الوزن والعيار.
//
// العقد موثّق في docs/repair-api.md — أي تغيير هنا يجب أن ينعكس هناك لأن تطبيق الصيانة
// يعتمد عليه، وهو يتدهور بلطف: إن تعذّر الوصول لهذه الدالة يُكمل الموظف بالإدخال اليدوي.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** الحقول التي نكشفها عن الموظف — بلا بريد أو أي شيء لا يحتاجه تطبيق الصيانة. */
type StaffOut = {
  staff_id: string;
  full_name: string;
  role: string;
  branch_id: string | null;
  branch_name: string | null;
};

async function loadStaff(admin: ReturnType<typeof createClient>, userId: string): Promise<StaffOut | null> {
  const { data: profile } = await admin
    .from("profiles")
    .select("id, full_name, branch_id, is_active, branches(name)")
    .eq("id", userId)
    .maybeSingle();
  // موظف موقوف في المخزون موقوف في الصيانة أيضاً — وإلا بقي له باب خلفي بعد إنهاء خدمته.
  if (!profile || profile.is_active === false) return null;

  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", userId);
  // ترتيب الأولوية مهم: صاحب أكثر من دور يُعامل بأعلاها صلاحية في تطبيق الصيانة أيضاً.
  const ranked = ["admin", "manager", "employee"];
  const role = ranked.find((r) => (roles ?? []).some((x: any) => x.role === r)) ?? "employee";

  return {
    staff_id: profile.id as string,
    full_name: profile.full_name as string,
    role,
    branch_id: (profile.branch_id as string | null) ?? null,
    branch_name: ((profile as any).branches?.name as string | undefined) ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const API_KEY = Deno.env.get("REPAIR_API_KEY");

  // بلا مفتاح مضبوط تبقى الدالة مقفلة بالكامل بدل أن تنفتح للجميع صامتة.
  if (!API_KEY) return json({ error: "repair_api_not_configured" }, 503);

  const presented = req.headers.get("x-api-key") ?? "";
  if (presented.length !== API_KEY.length || !timingSafeEqual(presented, API_KEY)) {
    return json({ error: "unauthorized" }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE);
  const url = new URL(req.url);
  // المسار يصل كـ /repair-api/<route> — نقتطع اسم الدالة ونوجّه على الباقي.
  const route = url.pathname.replace(/^\/+/, "").split("/").slice(1).join("/").replace(/\/+$/, "");

  try {
    // ——— تسجيل دخول الموظف بحساب المخزون نفسه ———
    // تطبيق الصيانة لا يحتفظ بكلمات المرور؛ يمرّرها مرة واحدة هنا ثم يصدر جلسته الخاصة.
    if (route === "auth/login" && req.method === "POST") {
      const { email, password } = await req.json().catch(() => ({}));
      if (!email || !password) return json({ error: "missing_credentials" }, 400);

      const userClient = createClient(SUPABASE_URL, ANON);
      const { data, error } = await userClient.auth.signInWithPassword({ email, password });
      if (error || !data.user) return json({ error: "invalid_credentials" }, 401);

      const staff = await loadStaff(admin, data.user.id);
      if (!staff) return json({ error: "no_profile" }, 403);
      // نُنهي الجلسة فوراً — الغرض كان التحقق فقط، ولا نريد توكناً حياً يتسرّب للتطبيق الآخر.
      await userClient.auth.signOut();
      return json({ staff });
    }

    // ——— التحقق من موظف عبر معرّفه (لتحديث الاسم/الفرع عند تغيّرها في المخزون) ———
    if (route === "auth/staff" && req.method === "GET") {
      const id = url.searchParams.get("staff_id");
      if (!id) return json({ error: "missing_staff_id" }, 400);
      const staff = await loadStaff(admin, id);
      if (!staff) return json({ error: "not_found" }, 404);
      return json({ staff });
    }

    // ——— الفروع ———
    if (route === "branches" && req.method === "GET") {
      const { data, error } = await admin
        .from("branches")
        .select("id, name, name_en, code, phone, is_active")
        .eq("is_active", true)
        .order("code", { ascending: true });
      if (error) throw error;
      return json({ branches: data ?? [] });
    }

    // ——— بحث الزبون بالهاتف ———
    // الهاتف غير فريد في المخزون، لذا نُرجع قائمة ونترك الاختيار للموظف.
    if (route === "customers/lookup" && req.method === "GET") {
      const phone = (url.searchParams.get("phone") ?? "").trim();
      if (phone.length < 3) return json({ error: "phone_too_short" }, 400);
      const digits = phone.replace(/\D/g, "");
      const { data, error } = await admin
        .from("customers")
        .select("id, full_name, phone, branch_id")
        // نطابق آخر 6 أرقام حتى لا يفشل البحث بسبب صيغة الرقم (مقدمة دولية، صفر، فراغات).
        .ilike("phone", `%${digits.slice(-6)}%`)
        .limit(10);
      if (error) throw error;
      return json({ customers: data ?? [] });
    }

    // ——— إنشاء زبون في المخزون (حين يكون الزبون جديداً تماماً) ———
    if (route === "customers" && req.method === "POST") {
      const { full_name, phone, branch_id, notes } = await req.json().catch(() => ({}));
      if (!full_name) return json({ error: "missing_full_name" }, 400);
      const { data, error } = await admin
        .from("customers")
        .insert({ full_name, phone: phone ?? null, branch_id: branch_id ?? null, notes: notes ?? null })
        .select("id, full_name, phone, branch_id")
        .single();
      if (error) throw error;
      return json({ customer: data });
    }

    // ——— بحث القطعة بالكود ———
    // نبحث في المخزون الحالي أولاً، ثم في المبيعات (قطعة مباعة سابقاً عادت للصيانة) —
    // وهذه هي الحالة الغالبة، لأن الزبون يأتي بقطعة اشتراها من عندنا.
    if (route === "items/lookup" && req.method === "GET") {
      const code = (url.searchParams.get("code") ?? "").trim();
      if (!code) return json({ error: "missing_code" }, 400);

      const { data: product } = await admin
        .from("products")
        .select("id, sku, name, item_type, karat, weight_grams, ring_size, branch_id, status")
        .eq("sku", code)
        .maybeSingle();

      if (product) {
        // إن كانت مباعة نرفق بيانات البيع ليعرف الموظف لمن بيعت ومتى (للضمان).
        const { data: sale } = await admin
          .from("sales")
          .select("id, sold_at, customer_id, customer_name, customer_phone, weight_grams, karat")
          .eq("product_id", product.id)
          .order("sold_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        return json({
          item: {
            source: "product",
            product_id: product.id,
            sku: product.sku,
            name: product.name,
            item_type: product.item_type,
            // وزن/عيار لحظة البيع أدق من الحالي إن وُجد، لأن سجل البيع لقطة مجمّدة.
            karat: sale?.karat ?? product.karat,
            weight_grams: sale?.weight_grams ?? product.weight_grams,
            ring_size: product.ring_size,
            branch_id: product.branch_id,
            status: product.status,
            sale: sale
              ? {
                  sale_id: sale.id,
                  sold_at: sale.sold_at,
                  customer_id: sale.customer_id,
                  customer_name: sale.customer_name,
                  customer_phone: sale.customer_phone,
                }
              : null,
          },
        });
      }

      // القطعة قد تكون محذوفة من المخزون لكن سجل بيعها باقٍ — نكمل منه.
      const { data: sale } = await admin
        .from("sales")
        .select("id, product_id, product_name_snapshot, sku_snapshot, weight_grams, karat, branch_id, sold_at, customer_id, customer_name, customer_phone")
        .eq("sku_snapshot", code)
        .order("sold_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (sale) {
        return json({
          item: {
            source: "sale",
            product_id: sale.product_id,
            sku: sale.sku_snapshot,
            name: sale.product_name_snapshot,
            item_type: null,
            karat: sale.karat,
            weight_grams: sale.weight_grams,
            ring_size: null,
            branch_id: sale.branch_id,
            status: "sold",
            sale: {
              sale_id: sale.id,
              sold_at: sale.sold_at,
              customer_id: sale.customer_id,
              customer_name: sale.customer_name,
              customer_phone: sale.customer_phone,
            },
          },
        });
      }

      return json({ item: null }, 404);
    }

    // ——— تحديث حالة القطعة (دخول/خروج الصيانة) ———
    // اختياري من جهة تطبيق الصيانة: إن فشل لا يتعطّل فتح التذكرة.
    if (route === "items/status" && req.method === "POST") {
      const { product_id, status } = await req.json().catch(() => ({}));
      const allowed = ["in_repair", "available", "sold"];
      if (!product_id || !allowed.includes(status)) return json({ error: "invalid_request" }, 400);
      const { error } = await admin.from("products").update({ status }).eq("id", product_id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (route === "health" && req.method === "GET") return json({ ok: true });

    return json({ error: "not_found", route }, 404);
  } catch (err) {
    console.error("repair-api error", route, err);
    return json({ error: "server_error" }, 500);
  }
});

/** مقارنة بزمن ثابت — تفادياً لتسريب المفتاح عبر توقيت الرد. */
function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
