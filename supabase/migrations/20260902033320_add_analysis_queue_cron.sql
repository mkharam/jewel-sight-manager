-- يفعّل pg_cron وpg_net (اتصال HTTP غير متزامن من داخل Postgres) ويجدول استدعاء
-- process-analysis-queue كل 15 ثانية — طابور معالجة خلفي بدل توازي المتصفح الهش.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select
  cron.schedule(
    'process-analysis-queue-every-15s',
    '15 seconds',
    $$
    select net.http_post(
      url := 'https://iiyaytfdxfvjcvzlnlpp.supabase.co/functions/v1/process-analysis-queue',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-queue-secret', '555b188d91d392e574d5b939db23f50d39e4a9c68c425350'
      ),
      body := '{}'::jsonb
    );
    $$
  );
