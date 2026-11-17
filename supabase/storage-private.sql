-- Apply only after explicit staging approval. Does not alter existing buckets/policies.
begin;
do $$ begin
 if exists(select 1 from storage.buckets where id='asia-private-media') then
   if exists(select 1 from storage.buckets where id='asia-private-media' and public) then
     raise exception 'Existing bucket is public; investigate manually';
   end if;
 else
   insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values('asia-private-media','asia-private-media',false,8388608,array['image/webp']);
 end if;
 -- Bucket privacy does not override permissive object RLS policies.
 -- Fail closed if any existing broad policies could apply. Review individually.
 if exists(select 1 from pg_policies where schemaname='storage' and tablename='objects') then
   raise exception 'Review existing Storage object policies before applying private bucket migration';
 end if;
end $$;
-- No browser policies. Server proxy checks SQL visibility before reading.
-- Service role stays exclusively in server secret management.
commit;
