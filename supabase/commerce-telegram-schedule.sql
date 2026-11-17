-- STAGING xnnxmhwvixrqenunhhbt only.
-- Enable pg_cron and pg_net in Dashboard before running.
-- In Vault create these names using the existing credentials:
-- asia_edition_telegram_cron = COMMERCE_TELEGRAM_CRON_SECRET
-- asia_edition_vercel_bypass = the existing Vercel Automation Bypass Secret
-- No tokens belong in this SQL file.
begin;
do $$
begin
  if not exists(select 1 from pg_extension where extname='pg_cron')
     or not exists(select 1 from pg_extension where extname='pg_net') then
    raise exception 'Enable Cron and pg_net in staging Dashboard first';
  end if;
  if not exists(select 1 from vault.decrypted_secrets where name='asia_edition_telegram_cron')
     or not exists(select 1 from vault.decrypted_secrets where name='asia_edition_vercel_bypass') then
    raise exception 'Expected Vault credentials missing';
  end if;
end $$;
-- pg_net queues plaintext HTTP headers briefly. Restrict access for API roles.
revoke usage on schema net from public,anon,authenticated;
revoke all on net.http_request_queue from public,anon,authenticated;
select cron.schedule(
  'asia-edition-staging-telegram',
  '* * * * *',
  $job$
    select net.http_post(
      url := 'https://asia-edition-staging-pricol1.vercel.app/api/commerce-telegram',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='asia_edition_telegram_cron'),
        'x-vercel-protection-bypass',(select decrypted_secret from vault.decrypted_secrets where name='asia_edition_vercel_bypass')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $job$
);
commit;
