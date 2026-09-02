// تحليل صورة مجوهرات — مزوّدات مجانية فقط (Groq → Gemini)، بدون Lovable AI.
// Body: { imageBase64, mimeType?, categories?, imageId?, analysis? }

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  analysisToEmbeddingText,
  analyzeWithFallback,
  embedText,
  friendlyError,
  type JewelryAnalysis,
} from "../_shared/lovable-ai.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();

    // نداء من trigger قاعدة البيانات: { table: "product_images", record: {...} }
    if (body?.table === "product_images" && body?.record) {
      const secret = Deno.env.get("PRODUCT_IMAGE_WEBHOOK_SECRET") ?? "";
      if (!secret || req.headers.get("x-webhook-secret") !== secret) {
        return json({ error: "unauthorized" }, 401);
      }
      return json(await analyzeFromRecord(body.record));
    }

    const imageBase64: string | undefined = body?.imageBase64;
    const mimeType: string = body?.mimeType ?? "image/jpeg";
    const categories: { id: string; name: string }[] = body?.categories ?? [];
    const imageId: string | undefined = body?.imageId;
    const providedAnalysis: JewelryAnalysis | undefined = body?.analysis;

    if (!providedAnalysis && !imageBase64) {
      return json({ error: "imageBase64 or analysis required" }, 400);
    }

    let analysis: JewelryAnalysis;
    let provider = "cached";
    let usage: Record<string, { used: number; limit: number }> | undefined;
    if (providedAnalysis) {
      analysis = providedAnalysis;
    } else {
      const r = await analyzeWithFallback({
        imageBase64: imageBase64!,
        mimeType,
        categoryNames: categories.map((c) => c.name),
      });
      analysis = r.analysis;
      provider = r.provider;
      usage = r.usage;
    }

    let categoryId: string | null = null;
    if (analysis.category_name) {
      const cat = categories.find(
        (c) =>
          c.name === analysis.category_name ||
          c.name.includes(analysis.category_name!) ||
          analysis.category_name!.includes(c.name),
      );
      categoryId = cat?.id ?? null;
    }

    // embedding اختياري — يُستخدم للبحث بالصورة
    if (imageId) {
      try {
        const embedding = await embedText(analysisToEmbeddingText(analysis));
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        await supabase
          .from("product_images")
          .update({
            ai_labels: { ...analysis, category_id: categoryId },
            ai_embedding: embedding as unknown as string,
          })
          .eq("id", imageId);
      } catch (e) {
        console.error("Embedding step failed (non-fatal)", e);
      }
    }

    return json({ ...analysis, category_id: categoryId, provider, usage });
  } catch (e) {
    const { status, message } = friendlyError(e);
    if (status === 429) {
      return json({ error: message, code: "AI_BUSY", retryable: true }, 200);
    }
    return json({ error: message }, status);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// تحليل صورة مرفوعة تلقائياً بعد الإدراج في product_images
async function analyzeFromRecord(record: { id: string; storage_path: string; ai_labels?: unknown }) {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const labels = record.ai_labels as Record<string, unknown> | null;
  if (labels && Object.keys(labels).length > 0) return { skipped: "already analyzed" };

  const { data: file, error: dlErr } = await admin.storage
    .from("product-images")
    .download(record.storage_path);
  if (dlErr || !file) return { error: "download failed", detail: dlErr?.message };

  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  const base64 = btoa(binary);

  const { data: cats } = await admin.from("categories").select("id, name");
  const categories = cats ?? [];

  const { analysis, provider } = await analyzeWithFallback({
    imageBase64: base64,
    mimeType: file.type || "image/jpeg",
    categoryNames: categories.map((c: { name: string }) => c.name),
  });

  let categoryId: string | null = null;
  if (analysis.category_name) {
    const cat = categories.find(
      (c: { id: string; name: string }) =>
        c.name === analysis.category_name ||
        c.name.includes(analysis.category_name!) ||
        analysis.category_name!.includes(c.name),
    );
    categoryId = cat?.id ?? null;
  }

  let embedding: unknown = null;
  try {
    embedding = await embedText(analysisToEmbeddingText(analysis));
  } catch (e) {
    console.error("embedding failed (non-fatal)", e);
  }

  await admin
    .from("product_images")
    .update({
      ai_labels: { ...analysis, category_id: categoryId },
      ...(embedding ? { ai_embedding: embedding as unknown as string } : {}),
    })
    .eq("id", record.id);

  return { ok: true, provider, imageId: record.id };
}
