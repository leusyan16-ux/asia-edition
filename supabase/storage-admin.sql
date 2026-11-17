-- Run once, AFTER both inventory migrations, in the separate ASIA EDITION project.
begin;
do $$ begin
 if exists(select 1 from storage.buckets where id='tour-images' or name='tour-images') then
  raise exception 'tour-images already exists; review its contents and policies before proceeding';
 end if;
 if not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='storage' and c.relname='objects' and c.relrowsecurity) then
  raise exception 'Storage objects RLS must be enabled';
 end if;
 -- Permissive policies combine with OR. Do not trust unknown existing policies.
 if exists(select 1 from pg_catalog.pg_policies where schemaname='storage' and tablename='objects') then
  raise exception 'Existing Storage policies require review; this script expects a new project';
 end if;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('tour-images','tour-images',true,8388608,array['image/jpeg','image/png','image/webp']);

-- Resolve public/signed/authenticated/render URLs, query strings and percent escapes.
-- Ambiguous references to this bucket block deletion rather than guessing.
create function public.tour_image_object_path(image_url text) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare clean text;raw_path text;decoded_path text;bytes bytea='';i integer=1;ch text;
begin
 clean=split_part(split_part(image_url,'?',1),'#',1);
 raw_path=substring(clean from '/storage/v1/(?:object|render/image)/(?:public|sign|authenticated)/tour-images/(.*)$');
 if raw_path is null then return case when image_url ilike '%tour-images%' or image_url ilike '%/storage/v1/%' then '*' else null end;end if;
 while i<=length(raw_path) loop
  ch=substring(raw_path from i for 1);
  if ch='%' then
   if substring(raw_path from i+1 for 2)!~'^[0-9A-Fa-f]{2}$' then return '*';end if;
   bytes=bytes||decode(substring(raw_path from i+1 for 2),'hex');i=i+3;
  else bytes=bytes||convert_to(ch,'UTF8');i=i+1;end if;
 end loop;
 decoded_path=convert_from(bytes,'UTF8');
 if decoded_path !~ '^admin/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpg|png|webp)$' then return '*';end if;
 return decoded_path;
exception when others then return '*';
end $$;
revoke all on function public.tour_image_object_path(text) from public,anon,authenticated;
create function public.admin_image_is_unused(object_name text) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_inventory_admin() then return false;end if;
 if object_name !~ '^admin/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpg|png|webp)$' then return false;end if;
 return not exists(select 1 from public.tour_images i where public.tour_image_object_path(i.url) in (object_name,'*'));
end $$;
revoke all on function public.admin_image_is_unused(text) from public,anon,authenticated;
grant execute on function public.admin_image_is_unused(text) to authenticated;
create policy admin_image_insert on storage.objects for insert to authenticated
with check(bucket_id='tour-images' and public.is_inventory_admin()
 and name ~ '^admin/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpg|png|webp)$');
create policy admin_image_read on storage.objects for select to authenticated
using(bucket_id='tour-images' and public.is_inventory_admin());
create policy admin_image_delete on storage.objects for delete to authenticated
using(bucket_id='tour-images' and public.admin_image_is_unused(name));
-- No UPDATE policy. Public retrieval is intentional, including draft images.
commit;
