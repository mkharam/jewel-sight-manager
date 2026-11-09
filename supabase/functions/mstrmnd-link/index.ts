// الربط مع MSTRMND (api.digitalwallet.cards) بحساب الماسح «ربط تطبيق مخرّم».
// الدخول بكلمة السر يطلب reCAPTCHA، فما ندخلوش من هنا: صاحب المحل يدخل مرة بيده لتطبيق الماسح
// وينسخ refresh_token للسر MSTRMND_REFRESH_TOKEN، وهنا نجددو بـ /auth/refresh (نفس اللي يديره الماسح).
// الرمز الجديد يتحفظ في جدول mstrmnd_auth لأن MSTRMND ممكن يبدّل رمز التجديد مع كل تجديد.
//
// ?action=ping → يجدد الدخول لو يلزم ويقرا عدد البطاقات بس. ما يكتب شي في MSTRMND.
// ?action=sync (يطلب x-cron-key) → فواتير أمارسوفت الجديدة اللي فيها رقم زبون عنده بطاقة ولاء: البيع يتزاد
//   على البطاقة (add-point، نفس الماسح لبطاقة الخصم)، والمرتجع والفاتورة المحذوفة ينقصوا (subtract-point).
//   الوضع من mstrmnd_sync_settings.mode: dry يسجّل شن كان بيبعت بلا كتابة، live يكتب فعلاً.
//   وبطاقة الأختام (stamp_template_id): ختم على كل فاتورة بيع (add-stamp)، وينقص لو الفاتورة انحذفت.
//   وكل نص ساعة ينسخ زبائن MSTRMND وبطاقاتهم (mstrmnd_customers) وعملياتهم (mstrmnd_transactions) لصفحة الولاء.
//   الفاتورة اللي توصل من أمارسوفت تشغّله فوراً (mstrmnd_kick من قاعدة البيانات)، والـ cron كل 10 دقايق احتياط.
//   قفل (mstrmnd_link_acquire) يمنع تشغيلتين مع بعض، باش ما تتزادش نفس الفاتورة مرتين.
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
type Settings = { mode: "dry" | "live"; template_id: number; stamp_template_id: number | null; mirror_at: string | null };

// عدّادات MSTRMND تجي أحياناً {prev, current}.
const num = (v: any) => Number(v && typeof v === "object" ? v.current : v ?? 0) || 0;

// ملخص البطاقة اللي تحتاجه صفحة «بطاقات الزبائن».
function cardSummary(k: any, stampsPerReward: number) {
  const stamps = num(k.countStampsTotal), rewards = num(k.countRewardsTotal);
  return {
    template_id: Number(k.userTemplateId), card_id: Number(k.id), status: k.status ?? null,
    expires: k.cardExpiryDate > 86400 ? k.cardExpiryDate : null,
    level: k.discountCardLevelName ?? null, discount_pct: k.discountPercentage != null ? Number(k.discountPercentage) : null,
    to_next: k.toNextLevelOfDiscountCard != null ? Number(k.toNextLevelOfDiscountCard) : null,
    visits: num(k.countVisits), stamps_total: stamps,
    stamps_now: stampsPerReward ? Math.max(0, stamps - rewards * stampsPerReward) : null,
    rewards_unused: num(k.countRewardsTotalUnused), rewards_received: num(k.countRewardsTotalReceived),
    balance: k.balance != null ? Number(k.balance) : null, last_money_at: k.lastMoneySpentDate > 86400 ? k.lastMoneySpentDate : null,
    // مجموع شرياته على البطاقة (المستوى منه)، ووقت ما طلّع البطاقة: صفحة الفواتير تعرف منهم مستواه وقت كل فاتورة.
    // (discountAmount في بطاقة الخصم = مجموع الشريات؛ pointsEarned يجي ديما 0.)
    purchases: k.discountAmount != null ? num(k.discountAmount) : null,
    card_created: k.createdAt > 86400 ? Number(k.createdAt) : null,
  };
}

async function sync(s: Settings) {
  const { mode } = s;
  const { token } = await accessToken();

  // زبائن MSTRMND برقم الهاتف (آخر 9 أرقام)، وبطاقاتهم نجيبوها وقت نحتاجوها بس.
  const people: any[] = [];
  const customers = new Map<string, string>();
  for (let page = 1; page < 20; page++) {
    const r = await api(`/customers?itemsPerPage=500&page=${page}`, token);
    // لو القائمة ما جاتش، نوقفو هنا بدل ما نسجّلو كل الفواتير «بلا زبون» ونخسروها.
    if (r.status !== 200) throw new Error(`customers ${r.status}`);
    const rows = list(r.body).map((c: any) => ({ ...attrs(c), _id: String(c.id ?? attrs(c).id) }));
    people.push(...rows);
    for (const c of rows) if (phone9(c.phone).length === 9) customers.set(phone9(c.phone), c._id);
    if (rows.length < 500) break;
  }
  const cardsOf = new Map<string, any[]>();
  async function cards(customerId: string) {
    if (!cardsOf.has(customerId)) {
      const r = await api(`/customers/${customerId}/cards`, token);
      if (r.status !== 200) throw new Error(`cards ${r.status}`);
      cardsOf.set(customerId, list(r.body).map(attrs));
    }
    return cardsOf.get(customerId)!;
  }
  const cardFor = async (customerId: string, templateId: number) =>
    (await cards(customerId)).find((k: any) => Number(k.userTemplateId) === templateId) ?? null;

  // كتابة في MSTRMND: نقاط بطاقة الخصم (قيمة الفاتورة) أو ختم بطاقة الأختام.
  async function write(cardId: number, kind: "point" | "stamp", action: "add" | "subtract", amount: number, comment: string, purchase: number | null) {
    if (mode === "dry") return { status: null, ok: true, err: null };
    const body = kind === "point"
      ? { sourceType: 1, points: amount, comment, purchaseSum: action === "add" ? purchase : null }
      : { sourceType: 1, stamps: amount, comment, purchaseSum: action === "add" ? purchase : null };
    const r = await api(`/cards/${cardId}/${action}-${kind}`, token, { method: "POST", body: JSON.stringify(body) });
    const ok = r.status >= 200 && r.status < 300;
    return { status: r.status, ok, err: ok ? null : String(r.body?.detail ?? r.body?.message ?? r.status).slice(0, 200) };
  }

  const counts: Record<string, number> = {};
  const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  const now = () => new Date().toISOString();
  // اللي بعتنالهم حاجة ننسخو بطاقاتهم في نفس التشغيل باش الصفحة تتحدّث طول؛ الحذف والتعديل (نادرين) ينسخو الكل.
  const touched = new Set<string>();
  let wroteAll = false;

  // 1) الفواتير الجديدة، لكل بطاقة على حدة.
  const programs: { templateId: number; kind: "point" | "stamp" }[] = [{ templateId: s.template_id, kind: "point" }];
  if (s.stamp_template_id) programs.push({ templateId: s.stamp_template_id, kind: "stamp" });
  for (const p of programs) {
    const { data: cand, error } = await db.rpc("mstrmnd_sync_candidates_t", { p_mode: mode, p_template: p.templateId, p_limit: 50 });
    if (error) throw new Error(`candidates: ${error.message}`);
    for (const inv of (cand ?? []) as Candidate[]) {
      const isReturn = inv.kind === "return" || inv.net_dirhams < 0;
      const ld = Math.round(Math.abs(inv.net_dirhams) / 1000);
      // الختم على البيع بس؛ المرتجع ما ينقصش ختم (الختم ينقص بس لو الفاتورة نفسها انحذفت).
      const action = isReturn ? "subtract" : "add";
      const amount = p.kind === "point" ? ld : 1;
      const row: Record<string, unknown> = { invoice_id: inv.id, mode, template_id: p.templateId, action, amount_ld: p.kind === "point" ? ld : 1, updated_at: now() };
      const customerId = customers.get(inv.phone9);
      const card = customerId ? await cardFor(customerId, p.templateId) : null;
      if (!ld) Object.assign(row, { status: "skipped", reason: "zero_amount" });
      else if (p.kind === "stamp" && isReturn) Object.assign(row, { status: "skipped", reason: "return_no_stamp" });
      else if (!customerId) Object.assign(row, { status: "skipped", reason: "no_mstrmnd_customer" });
      else if (!card) Object.assign(row, { status: "skipped", reason: p.kind === "point" ? "no_loyalty_card" : "no_stamp_card", mstrmnd_customer_id: customerId });
      else {
        const w = await write(Number(card.id), p.kind, action, amount, `أمارسوفت ${inv.branch_code}-${inv.invoice_no}`, ld);
        // البطاقة تبدّلت: النسخة اللي تحت تقرا الأرقام الجديدة بدل اللي قبل الإرسال.
        if (w.ok && mode === "live") { cardsOf.delete(customerId); touched.add(customerId); }
        Object.assign(row, {
          mstrmnd_customer_id: customerId, card_id: Number(card.id), http_status: w.status,
          status: mode === "dry" ? "would_send" : w.ok ? "sent" : "error", reason: w.err,
        });
      }
      await db.from("mstrmnd_sync").upsert(row);
      bump(`${p.kind}_${row.status}`);
    }
  }

  // 2) فواتير تبعتت وبعدها انحذفت في أمارسوفت → ننقصوها من نفس البطاقة.
  const { data: rev } = await db.rpc("mstrmnd_sync_reversals_t", { p_mode: mode });
  for (const r of (rev ?? []) as { invoice_id: number; template_id: number; amount_ld: number; card_id: number; branch_code: string; invoice_no: string }[]) {
    const kind = r.template_id === s.stamp_template_id ? "stamp" : "point";
    const w = await write(r.card_id, kind, "subtract", r.amount_ld, `حذف فاتورة أمارسوفت ${r.branch_code}-${r.invoice_no}`, null);
    if (w.ok && mode === "live") { cardsOf.clear(); wroteAll = true; }
    const status = mode === "dry" ? "would_reverse" : w.ok ? "reversed" : "sent";
    await db.from("mstrmnd_sync").update({ status, reason: w.err, http_status: w.status, updated_at: now() })
      .eq("invoice_id", r.invoice_id).eq("mode", mode).eq("template_id", r.template_id);
    bump(mode === "dry" || w.ok ? `${kind}_${status}` : `${kind}_reverse_error`);
  }

  // 2ب) فاتورة تبعتت وبعدها الموظف عدّل قيمتها → الفرق بس يتزاد ولا ينقص (المرتجع بالعكس).
  //     لو الكتابة فشلت، amount_ld يبقى قديم وتتعاود في التشغيلة الجاية.
  const { data: adj } = await db.rpc("mstrmnd_sync_adjustments_t", { p_mode: mode });
  for (const r of (adj ?? []) as { invoice_id: number; template_id: number; card_id: number; action: string; amount_ld: number; ld_now: number; branch_code: string; invoice_no: string }[]) {
    if (mode !== "live") break;
    const delta = (r.ld_now - r.amount_ld) * (r.action === "subtract" ? -1 : 1);
    const w = await write(r.card_id, "point", delta > 0 ? "add" : "subtract", Math.abs(delta),
      `تعديل فاتورة أمارسوفت ${r.branch_code}-${r.invoice_no}`, delta > 0 ? Math.abs(delta) : null);
    if (w.ok) {
      cardsOf.clear(); wroteAll = true;
      await db.from("mstrmnd_sync").update({ amount_ld: r.ld_now, reason: `تعدّلت: كانت ${r.amount_ld}`, http_status: w.status, updated_at: now() })
        .eq("invoice_id", r.invoice_id).eq("mode", mode).eq("template_id", r.template_id);
    }
    bump(w.ok ? "point_adjusted" : "point_adjust_error");
  }

  // 3) نسخة زبائن MSTRMND وبطاقاتهم للصفحة: الكل كل نص ساعة، واللي تبدّلت بطاقاتهم توا في نفس اللحظة.
  const tplStamps = async () => Number((await api(`/user_templates/${s.stamp_template_id ?? s.template_id}`, token)).body?.stampsNumber ?? 0) || 0;
  const mirrorRow = async (c: any, stampsPerReward: number) => ({
    id: c._id, full_name: String(c.fullName ?? [c.firstName, c.surname].filter(Boolean).join(" ")).trim() || null,
    phone9: phone9(c.phone) || null,
    created_at: c.createdAt ? new Date(Number.isFinite(Number(c.createdAt)) ? Number(c.createdAt) * 1000 : c.createdAt).toISOString() : null,
    cards: (await cards(c._id)).map((k: any) => cardSummary(k, Number(k.userTemplateId) === s.stamp_template_id ? stampsPerReward : 0)),
    synced_at: now(),
  });
  let mirrored: boolean | "touched" = false;
  if (!wroteAll && touched.size && !(!s.mirror_at || Date.now() - new Date(s.mirror_at).getTime() > 30 * 60_000)) {
    const spr = await tplStamps();
    const rows = [];
    for (const c of people) if (touched.has(c._id)) rows.push(await mirrorRow(c, spr));
    if (rows.length) await db.from("mstrmnd_customers").upsert(rows);
    mirrored = "touched";
  } else if (wroteAll || touched.size || !s.mirror_at || Date.now() - new Date(s.mirror_at).getTime() > 30 * 60_000) {
    const spr = await tplStamps();
    const rows = [];
    for (const c of people) rows.push(await mirrorRow(c, spr));
    if (rows.length) {
      await db.from("mstrmnd_customers").upsert(rows);
      await db.from("mstrmnd_customers").delete().not("id", "in", `(${rows.map((r) => `"${r.id}"`).join(",")})`);
    }
    // عمليات MSTRMND (المسح بالفرع، التركيب، الأختام...) لتقرير الفروع. وقت MSTRMND بتوقيت طرابلس (+02:00).
    for (let page = 1; page <= 5; page++) {
      const t = await api(`/transactions?itemsPerPage=1000&page=${page}`, token);
      if (t.status !== 200) break;
      const txs = list(t.body).map(attrs).filter((x: any) => x?.id).map((x: any) => ({
        id: Number(x.id), customer_id: x.customerId ?? null, template_id: x.templateId != null ? Number(x.templateId) : null,
        operation: String(x.operationName ?? "").trim(), amount: x.amount !== "" && x.amount != null ? Number(x.amount) : null,
        purchase_sum: x.purchaseSum != null ? Number(x.purchaseSum) / 1000 : null, location: String(x.location ?? "").trim() || null,
        manager: String(x.managerName ?? "").trim() || null, device: x.device || null, utm: x.utmSource || null,
        reversed: Boolean(x.reversed), created_at: x.createdAt ? new Date(String(x.createdAt).replace(" ", "T") + "+02:00").toISOString() : null,
      }));
      if (txs.length) await db.from("mstrmnd_transactions").upsert(txs);
      if (txs.length < 1000) break;
    }
    await db.from("mstrmnd_sync_settings").update({ mirror_at: now() }).eq("id", 1);
    mirrored = true;
  }
  return { mode, customers: customers.size, mirrored, ...counts };
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
      // الربط شغال توا: طلبنا منه دورة زيادة بعد ما يكمّل، وهي اللي تاخذ الفاتورة الجديدة.
      const { data: got, error: lockErr } = await db.rpc("mstrmnd_link_acquire", { p_seconds: 150 });
      if (lockErr) throw new Error(`lock: ${lockErr.message}`);
      if (!got) return json({ queued: true });
      let result: Record<string, unknown> = {};
      try {
        for (let round = 1; ; round++) {
          const { data: cur } = await db.from("mstrmnd_sync_settings").select("*").eq("id", 1).single();
          result = { ...(await sync(cur as Settings)), round };
          await db.from("mstrmnd_sync_settings").update({ last_run_at: new Date().toISOString(), last_result: result }).eq("id", 1);
          const { data: again } = await db.rpc("mstrmnd_link_release", { p_keep: round < 5 });
          if (!again) break;
        }
      } catch (e) {
        await db.rpc("mstrmnd_link_release", { p_keep: false });
        throw e;
      }
      return json(result);
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message) }, 500);
  }
});
