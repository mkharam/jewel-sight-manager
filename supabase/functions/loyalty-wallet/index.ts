// بطاقة الولاء في Apple Wallet و Google Wallet. تنفتح من صفحة البطاقة العامة (/card/:code) بلا تسجيل دخول.
//   ?type=status              → أي محفظة مفعّلة (حسب الأسرار الموجودة)، باش الصفحة تخفي الأزرار الباقية.
//   ?type=apple&code=...      → ملف .pkpass موقّع بشهادة Pass Type ID.
//   ?type=google&code=...     → يحدّث بطاقة الزبون في Google (أو يعملها) ويحوّل لرابط «Save to Google Wallet».
// البيانات من loyalty_card نفسها اللي تقرأها صفحة الويب، فالنقاط والمستوى نفس الأرقام.
//
// الأسرار:
//   Apple:  APPLE_PASS_TYPE_ID, APPLE_TEAM_ID, APPLE_PASS_CERT_PEM, APPLE_PASS_KEY_PEM, APPLE_WWDR_PEM
//   Google: GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_SA_JSON (مفتاح service account كامل)
//   الاثنين: LOYALTY_SITE_URL (مثلاً https://mkharam.github.io/jewel-sight-manager)
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import forge from "npm:node-forge@1.3.1";
import { zipSync, strToU8 } from "npm:fflate@0.8.2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) ?? "";

const SITE = env("LOYALTY_SITE_URL").replace(/\/$/, "");
const TIER_AR: Record<string, string> = { silver: "فضي", gold: "ذهبي", diamond: "ماسي" };
const TIER_BG: Record<string, string> = { silver: "#C9CED6", gold: "#D4A62A", diamond: "#27306B" };
const TIER_FG: Record<string, string> = { silver: "#1E293B", gold: "#3B2A05", diamond: "#FFFFFF" };

const appleReady = () => ["APPLE_PASS_TYPE_ID", "APPLE_TEAM_ID", "APPLE_PASS_CERT_PEM", "APPLE_PASS_KEY_PEM", "APPLE_WWDR_PEM", "LOYALTY_SITE_URL"].every((k) => env(k));
const googleReady = () => ["GOOGLE_WALLET_ISSUER_ID", "GOOGLE_WALLET_SA_JSON", "LOYALTY_SITE_URL"].every((k) => env(k));

type Card = { program_name: string; full_name: string; points: number; tier: string; discount: number;
  next_tier: string | null; points_to_next: number | null; code: string };

async function loadCard(code: string): Promise<Card | null> {
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"));
  const { data, error } = await db.rpc("loyalty_card", { p_code: code });
  if (error) throw error;
  return (data?.[0] ?? null) as Card | null;
}

const cardLink = (code: string) => `${SITE}/card/${code}`;
const nextLine = (c: Card) => c.next_tier ? `${c.points_to_next} نقطة للمستوى ${TIER_AR[c.next_tier]}` : "أعلى مستوى";

// ---------------- Apple ----------------
const hex2rgb = (h: string) => {
  const n = parseInt(h.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

async function applePass(c: Card): Promise<Uint8Array> {
  const pass = {
    formatVersion: 1,
    passTypeIdentifier: env("APPLE_PASS_TYPE_ID"),
    teamIdentifier: env("APPLE_TEAM_ID"),
    serialNumber: c.code,
    organizationName: c.program_name,
    description: c.program_name,
    logoText: c.program_name,
    backgroundColor: hex2rgb(TIER_BG[c.tier]),
    foregroundColor: hex2rgb(TIER_FG[c.tier]),
    labelColor: hex2rgb(TIER_FG[c.tier]),
    storeCard: {
      headerFields: [{ key: "points", label: "النقاط", value: c.points }],
      primaryFields: [{ key: "tier", label: "المستوى", value: TIER_AR[c.tier] }],
      secondaryFields: [
        { key: "name", label: "الاسم", value: c.full_name },
        { key: "discount", label: "خصم المصنعية", value: `${c.discount}%` },
      ],
      backFields: [
        { key: "next", label: "المستوى الجاي", value: nextLine(c) },
        { key: "link", label: "البطاقة", value: cardLink(c.code) },
      ],
    },
    barcodes: [{ format: "PKBarcodeFormatQR", message: cardLink(c.code), messageEncoding: "iso-8859-1" }],
  };
  const icon = new Uint8Array(await (await fetch(`${SITE}/app-icon-192.png`)).arrayBuffer());
  const files: Record<string, Uint8Array> = {
    "pass.json": strToU8(JSON.stringify(pass)),
    "icon.png": icon, "icon@2x.png": icon, "logo.png": icon, "logo@2x.png": icon,
  };
  const manifest: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(files)) {
    const md = forge.md.sha1.create();
    md.update(forge.util.binary.raw.encode(bytes));
    manifest[name] = md.digest().toHex();
  }
  const manifestJson = JSON.stringify(manifest);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(manifestJson, "utf8");
  const cert = forge.pki.certificateFromPem(env("APPLE_PASS_CERT_PEM"));
  p7.addCertificate(cert);
  p7.addCertificate(forge.pki.certificateFromPem(env("APPLE_WWDR_PEM")));
  p7.addSigner({
    key: forge.pki.privateKeyFromPem(env("APPLE_PASS_KEY_PEM")),
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  p7.sign({ detached: true });
  const signature = forge.util.binary.raw.decode(forge.asn1.toDer(p7.toAsn1()).getBytes());

  return zipSync({ ...files, "manifest.json": strToU8(manifestJson), signature });
}

// ---------------- Google ----------------
// النص يتحوّل UTF-8 قبل base64 (الأسماء بالعربي).
const b64url = (s: string) => b64urlBytes(new TextEncoder().encode(s));
const b64urlBytes = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function signJwt(claims: Record<string, unknown>, sa: { private_key: string }) {
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const der = Uint8Array.from(atob(pem), (ch) => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(claims));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64urlBytes(sig)}`;
}

async function googleToken(sa: { client_email: string; private_key: string }) {
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/wallet_object.issuer",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }, sa);
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${assertion}` });
  if (!r.ok) throw new Error(`google token ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token as string;
}

const API = "https://walletobjects.googleapis.com/walletobjects/v1";

// يعمل البطاقة أو يحدّثها، باش الزبون لو ضغط الزر مرة ثانية يشوف نقاطه الجديدة.
async function upsert(token: string, kind: "loyaltyClass" | "loyaltyObject", id: string, body: Record<string, unknown>) {
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const ins = await fetch(`${API}/${kind}`, { method: "POST", headers: h, body: JSON.stringify(body) });
  if (ins.ok) return;
  if (ins.status !== 409) throw new Error(`${kind} insert ${ins.status}: ${await ins.text()}`);
  const up = await fetch(`${API}/${kind}/${encodeURIComponent(id)}`, { method: "PATCH", headers: h, body: JSON.stringify(body) });
  if (!up.ok) throw new Error(`${kind} patch ${up.status}: ${await up.text()}`);
}

async function googleSaveUrl(c: Card) {
  const sa = JSON.parse(env("GOOGLE_WALLET_SA_JSON"));
  const issuer = env("GOOGLE_WALLET_ISSUER_ID");
  const classId = `${issuer}.mkharam_loyalty`;
  const objectId = `${issuer}.card_${c.code}`;
  const token = await googleToken(sa);
  await upsert(token, "loyaltyClass", classId, {
    id: classId, issuerName: c.program_name, programName: c.program_name,
    programLogo: { sourceUri: { uri: `${SITE}/app-icon-512.png` } },
    hexBackgroundColor: TIER_BG.gold, reviewStatus: "UNDER_REVIEW",
  });
  await upsert(token, "loyaltyObject", objectId, {
    id: objectId, classId, state: "ACTIVE",
    accountId: c.code, accountName: c.full_name,
    hexBackgroundColor: TIER_BG[c.tier],
    loyaltyPoints: { label: "النقاط", balance: { int: c.points } },
    secondaryLoyaltyPoints: { label: "خصم المصنعية", balance: { string: `${c.discount}%` } },
    textModulesData: [
      { id: "tier", header: "المستوى", body: TIER_AR[c.tier] },
      { id: "next", header: "المستوى الجاي", body: nextLine(c) },
    ],
    barcode: { type: "QR_CODE", value: cardLink(c.code) },
    linksModuleData: { uris: [{ id: "card", uri: cardLink(c.code), description: "البطاقة" }] },
  });
  const jwt = await signJwt({ iss: sa.client_email, aud: "google", typ: "savetowallet", origins: [new URL(SITE).origin],
    payload: { loyaltyObjects: [{ id: objectId }] } }, sa);
  return `https://pay.google.com/gp/v/save/${jwt}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  if (type === "status") return json({ apple: appleReady(), google: googleReady() });

  const code = url.searchParams.get("code") ?? "";
  if (!/^[0-9a-f]{12,32}$/.test(code)) return json({ error: "bad code" }, 400);
  try {
    if (type === "apple" && appleReady()) {
      const c = await loadCard(code);
      if (!c) return json({ error: "not found" }, 404);
      return new Response(await applePass(c), { headers: { ...cors, "Content-Type": "application/vnd.apple.pkpass",
        "Content-Disposition": `attachment; filename="mkharam.pkpass"` } });
    }
    if (type === "google" && googleReady()) {
      const c = await loadCard(code);
      if (!c) return json({ error: "not found" }, 404);
      return Response.redirect(await googleSaveUrl(c), 302);
    }
    return json({ error: "wallet not configured" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "failed" }, 500);
  }
});
