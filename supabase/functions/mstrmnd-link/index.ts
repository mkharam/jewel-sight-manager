// الربط مع MSTRMND (api.digitalwallet.cards) بحساب الماسح «ربط تطبيق مخرّم».
// الدخول بكلمة السر يطلب reCAPTCHA، فما ندخلوش من هنا: صاحب المحل يدخل مرة بيده لتطبيق الماسح
// وينسخ refresh_token للسر MSTRMND_REFRESH_TOKEN، وهنا نجددو بـ /auth/refresh (نفس اللي يديره الماسح).
// الرمز الجديد يتحفظ في جدول mstrmnd_auth لأن MSTRMND ممكن يبدّل رمز التجديد مع كل تجديد.
//
// ?action=ping → يجدد الدخول لو يلزم ويقرا عدد البطاقات بس. ما يكتب شي في MSTRMND.
// ?action=sync (يطلب x-cron-key) → فواتير أمارسوفت الجديدة اللي فيها رقم زبون عنده بطاقة ولاء: البيع يتزاد
//   على البطاقة (add-point، نفس الماسح لبطاقة الخصم)، والمرتجع والفاتورة المحذوفة ينقصوا (subtract-point).
//   الوضع من mstrmnd_sync_settings.mode: dry يسجّل شن كان بيبعت بلا كتابة، live يكتب فعلاً.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const API = "https://api.digitalwallet.cards";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

// تاريخ انتهاء الـ JWT من داخله (exp)، بلا ما نتحققو من التوقيع — يكفي باش نعرفو متى نجددو.
function jwtExp(token: string): Date | null {
  try {
    const p = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return p.exp ? new Date(p.exp * 1000) : null;
  } catch {
    return null;
  }
}

type Auth = { refresh_token: string | null; access_token: string | null; access_expires_at: string | null; seed_hash: string | null };

// السر ممكن يكون refresh_token بروحه، أو قيمة «tokens» كاملة من المتصفح ({"refresh_token": …, "token": …}).
function seedToken(raw: string) {
  const s = raw.trim().replace(/^['"]|['"]$/g, "");
  if (!s.startsWith("{")) return s;
  try {
    return String(JSON.parse(s).refresh_token ?? "");
  } catch {
    return "";
  }
}

async function accessToken(): Promise<{ token: string; refreshed: boolean }> {
  const seed = seedToken(Deno.env.get("MSTRMND_REFRESH_TOKEN") ?? "");
  const seedHash = seed ? await sha256(seed) : null;
  const { data } = await db.from("mstrmnd_auth").select("*").eq("id", 1).maybeSingle();
  let row = (data ?? { refresh_token: null, access_token: null, access_expires_at: null, seed_hash: null }) as Auth;

  // سر جديد (أول مرة، أو صاحب المحل دخل من جديد وحط رمز جديد) → نبداو منه.
  if (seedHash && seedHash !== row.seed_hash) {
    row = { refresh_token: seed, access_token: null, access_expires_at: null, seed_hash: seedHash };
  }
  if (!row.refresh_token) throw new Error("no refresh token: set MSTRMND_REFRESH_TOKEN");

  const exp = row.access_expires_at ? new Date(row.access_expires_at) : null;
  if (row.access_token && exp && exp.getTime() - Date.now() > 60_000) return { token: row.access_token, refreshed: false };

  const r = await fetch(`${API}/auth/refresh`, {
    method: "POST",
    headers: { accept: "application/vnd.api+json", "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: row.refresh_token }),
  });
  const body = await r.json().catch(() => null);
  const token = body?.token ?? body?.data?.token ?? body?.data?.attributes?.token;
  if (!r.ok || !token) {
    await db.from("mstrmnd_auth").upsert({ id: 1, ...row, last_error: `refresh ${r.status}`, updated_at: new Date().toISOString() });
    throw new Error(`refresh failed ${r.status}`);
  }
  const newRefresh = body?.refresh_token ?? body?.data?.refresh_token ?? row.refresh_token;
  await db.from("mstrmnd_auth").upsert({
    id: 1, refresh_token: newRefresh, access_token: token, access_expires_at: jwtExp(token)?.toISOString() ?? null,
    seed_hash: row.seed_hash, last_error: null, updated_at: new Date().toISOString(),
  });
  return { token, refreshed: true };
}

async function api(path: string, token: string, init: RequestInit = {}) {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
  const body = await r.json().catch(() => null);
  return { status: r.status, body };
}

const list = (b: any) => (Array.isArray(b) ? b : b?.data ?? b?.["hydra:member"] ?? []);
const attrs = (x: any) => x?.attributes ?? x;
const phone9 = (p: unknown) => String(p ?? "").replace(/\D/g, "").slice(-9);

type Candidate = { id: number; branch_code: string; kind: string; invoice_no: string; net_dirhams: number; sold_at: string; phone9: string };

async function sync(mode: "dry" | "live", templateId: number) {
  const { token } = await accessToken();

  // زبائن MSTRMND برقم الهاتف (آخر 9 أرقام)، وبطاقة الولاء لكل زبون نجيبوها وقت نحتاجوها بس.
  const customers = new Map<string, string>();
  for (let page = 1; page < 20; page++) {
    const r = await api(`/customers?itemsPerPage=500&page=${page}`, token);
    // لو القائمة ما جاتش، نوقفو هنا بدل ما نسجّلو كل الفواتير «بلا زبون» ونخسروها.
    if (r.status !== 200) throw new Error(`customers ${r.status}`);
    const rows = list(r.body).map((c: any) => ({ ...attrs(c), _id: c.id }));
    for (const c of rows) if (phone9(c.phone).length === 9) customers.set(phone9(c.phone), String(c._id ?? c.id));
    if (rows.length < 500) break;
  }
  const cardOf = new Map<string, number | null>();
  async function loyaltyCard(customerId: string) {
    if (!cardOf.has(customerId)) {
      const r = await api(`/customers/${customerId}/cards`, token);
      if (r.status !== 200) throw new Error(`cards ${r.status}`);
      const card = list(r.body).map(attrs).find((k: any) => Number(k.userTemplateId) === templateId);
      cardOf.set(customerId, card ? Number(card.id) : null);
    }
    return cardOf.get(customerId)!;
  }

  async function write(cardId: number, action: "add" | "subtract", amount: number, comment: string) {
    if (mode === "dry") return { status: null, ok: true, err: null };
    const r = await api(`/cards/${cardId}/${action === "add" ? "add-point" : "subtract-point"}`, token, {
      method: "POST",
      body: JSON.stringify({ sourceType: 1, points: amount, comment, purchaseSum: action === "add" ? amount : null }),
    });
    const ok = r.status >= 200 && r.status < 300;
    return { status: r.status, ok, err: ok ? null : String(r.body?.detail ?? r.body?.message ?? r.status).slice(0, 200) };
  }

  const counts: Record<string, number> = {};
  const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  const now = () => new Date().toISOString();

  // 1) الفواتير الجديدة.
  const { data: cand, error } = await db.rpc("mstrmnd_sync_candidates", { p_mode: mode, p_limit: 50 });
  if (error) throw new Error(`candidates: ${error.message}`);
  for (const inv of (cand ?? []) as Candidate[]) {
    const action = inv.kind === "return" || inv.net_dirhams < 0 ? "subtract" : "add";
    const amount = Math.round(Math.abs(inv.net_dirhams) / 1000);
    const row: Record<string, unknown> = { invoice_id: inv.id, mode, action, amount_ld: amount, updated_at: now() };
    const customerId = customers.get(inv.phone9);
    const cardId = customerId ? await loyaltyCard(customerId) : null;
    if (!amount) Object.assign(row, { status: "skipped", reason: "zero_amount" });
    else if (!customerId) Object.assign(row, { status: "skipped", reason: "no_mstrmnd_customer" });
    else if (!cardId) Object.assign(row, { status: "skipped", reason: "no_loyalty_card", mstrmnd_customer_id: customerId });
    else {
      const w = await write(cardId, action, amount, `أمارسوفت ${inv.branch_code}-${inv.invoice_no}`);
      Object.assign(row, {
        mstrmnd_customer_id: customerId, card_id: cardId, http_status: w.status,
        status: mode === "dry" ? "would_send" : w.ok ? "sent" : "error", reason: w.err,
      });
    }
    await db.from("mstrmnd_sync").upsert(row);
    bump(String(row.status));
  }

  // 2) فواتير تبعتت وبعدها انحذفت في أمارسوفت → ننقصوها.
  const { data: rev } = await db.rpc("mstrmnd_sync_reversals", { p_mode: mode });
  for (const r of (rev ?? []) as { invoice_id: number; amount_ld: number; card_id: number; branch_code: string; invoice_no: string }[]) {
    const w = await write(r.card_id, "subtract", r.amount_ld, `حذف فاتورة أمارسوفت ${r.branch_code}-${r.invoice_no}`);
    const status = mode === "dry" ? "would_reverse" : w.ok ? "reversed" : "sent";
    await db.from("mstrmnd_sync").update({ status, reason: w.err, http_status: w.status, updated_at: now() })
      .eq("invoice_id", r.invoice_id).eq("mode", mode);
    bump(mode === "dry" || w.ok ? status : "reverse_error");
  }
  return { mode, customers: customers.size, ...counts };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const action = new URL(req.url).searchParams.get("action");
  try {
    if (action === "ping") {
      const { token, refreshed } = await accessToken();
      const t = await api("/user_templates/brief", token);
      const me = await api("/users/me", token);
      return json({
        ok: t.status === 200, refreshed, templates: list(t.body).length,
        account: { isManager: me.body?.isManager ?? null, name: me.body?.name ?? me.body?.fullName ?? null },
      });
    }
    if (action === "sync") {
      const { data: s } = await db.from("mstrmnd_sync_settings").select("*").eq("id", 1).single();
      if (!s || req.headers.get("x-cron-key") !== s.cron_key) return json({ error: "forbidden" }, 403);
      if (s.mode === "off") return json({ mode: "off" });
      const result = await sync(s.mode, s.template_id);
      await db.from("mstrmnd_sync_settings").update({ last_run_at: new Date().toISOString(), last_result: result }).eq("id", 1);
      return json(result);
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message) }, 500);
  }
});
