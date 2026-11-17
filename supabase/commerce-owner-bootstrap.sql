-- RUN MANUALLY ON STAGING ONLY after verified email registration. Never put credentials here.
-- Replace the UUID with the verified Auth user UUID. First owner only; no self-signup grant.
begin;
do $$ declare subject uuid := '00000000-0000-0000-0000-000000000000'; begin
 perform pg_advisory_xact_lock(188300008);
 if exists(select 1 from public.commerce_staff where role='owner') then raise exception 'An owner already exists; use the audited owner-only workflow'; end if;
 if not exists(select 1 from auth.users where id=subject and email_confirmed_at is not null) then raise exception 'Verified user required'; end if;
 insert into public.commerce_staff(user_id,role) values(subject,'owner');
 insert into public.commerce_audit(actor,action,resource) values(subject,'first_owner_bootstrap',subject);
end $$;
commit;
