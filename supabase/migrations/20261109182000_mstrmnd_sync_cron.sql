-- يشغّل ربط MSTRMND كل 10 دقائق. الوضع (off/dry/live) من mstrmnd_sync_settings، والمفتاح منها زادة.
select cron.schedule(
  'mstrmnd-sync-every-10m',
  '*/10 * * * *',
  $$
    select net.http_post(
      url := 'https://iiyaytfdxfvjcvzlnlpp.supabase.co/functions/v1/mstrmnd-link?action=sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-key', (select cron_key from public.mstrmnd_sync_settings where id = 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $$
);
