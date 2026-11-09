// الربط مع MSTRMND (api.digitalwallet.cards) بحساب الماسح «ربط تطبيق مخرّم».
// الدخول بكلمة السر يطلب reCAPTCHA، فما ندخلوش من هنا: صاحب المحل يدخل مرة بيده لتطبيق الماسح
// وينسخ refresh_token للسر MSTRMND_REFRESH_TOKEN، وهنا نجددو بـ /auth/refresh (نفس اللي يديره الماسح).
// الرمز الجديد يتحفظ في جدول mstrmnd_auth لأن MSTRMND ممكن يبدّل رمز التجديد مع كل تجديد.
//
// ?action=ping → يجدد الدخول لو يلزم ويقرا عدد البطاقات بس. ما يكتب شي في MSTRMND.
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
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message) }, 500);
  }
});
