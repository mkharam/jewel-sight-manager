// Receives Amarsoft sales batches from the shop server (scripts/amarsoft-sync.ps1).
// Auth: x-sync-key header, checked against sha256 hashes in amarsoft_sync_keys.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const key = req.headers.get("x-sync-key") ?? "";
  if (key.length < 32) return json(401, { error: "missing key" });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const hash = await sha256Hex(key);
  const { data: found, error: keyErr } = await supabase
    .from("amarsoft_sync_keys").select("key_hash").eq("key_hash", hash).maybeSingle();
  if (keyErr) return json(500, { error: "key check failed" });
  if (!found) return json(401, { error: "bad key" });

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "invalid json" });
  }
  // kind "master" = one branch's stock + customers; anything else = a sales batch.
  const master = payload.kind === "master";
  if (master ? !Array.isArray(payload.stock) : !Array.isArray(payload.invoices)) {
    return json(400, { error: master ? "stock must be an array" : "invoices must be an array" });
  }

  const { data, error } = await supabase.rpc(master ? "amarsoft_ingest_master" : "amarsoft_ingest", { p: payload });
  if (error) return json(500, { error: error.message });

  // Pieces added in the app before Amarsoft had their tag: re-check now that stock changed.
  if (master) {
    const { data: rechecked, error: recheckErr } = await supabase.rpc("amarsoft_recheck_pending");
    if (!recheckErr) (data as Record<string, unknown>).products_matched = rechecked;
  }

  await supabase.from("amarsoft_sync_keys").update({ last_used_at: new Date().toISOString() }).eq("key_hash", hash);
  return json(200, data);
});
