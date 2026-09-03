# Roadmap

## Blocked / awaiting user decision
- [ ] تأكيد أي قاعدة بيانات هي المصدر الصحيح: هذا المشروع مربوط بـ Lovable Cloud (ref `jzgzdy...`) وليس بـ `iiyaytfdxfvjcvzlnlpp` الذي عمل عليه المستخدم خارجياً.
- [ ] قرار بشأن trigger `analyze_product_image_on_insert` — موجود ونشط على قاعدة هذا المشروع (تعطيل أم دمج مع الطابور).
- [ ] خطة "Staff AI Assistant" عبر Lovable AI Gateway — مؤجّلة حتى يتم حلّ التزامن.

## Protected — لا تُعدّل
- `supabase/functions/process-analysis-queue/`
- `analyzeBatchWithFallback` وما يتعلق بها في `supabase/functions/_shared/lovable-ai.ts`
- pg_cron job `process-analysis-queue-every-15s` (على القاعدة الخارجية)

## Notes
- لا يوجد GitHub remote في هذا المشروع؛ الـ remote الوحيد هو مستودع Lovable الداخلي.
