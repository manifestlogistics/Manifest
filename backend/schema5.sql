-- Document storage for Manifest. Run once in Supabase: SQL editor -> paste -> Run.
insert into storage.buckets (id, name, public, file_size_limit)
values ('docs', 'docs', false, 15728640)
on conflict (id) do update set file_size_limit = 15728640, public = false;

drop policy if exists "docs read own" on storage.objects;
drop policy if exists "docs insert own" on storage.objects;
drop policy if exists "docs update own" on storage.objects;
drop policy if exists "docs delete own" on storage.objects;

create policy "docs read own" on storage.objects for select to authenticated
  using (bucket_id = 'docs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "docs insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'docs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "docs update own" on storage.objects for update to authenticated
  using (bucket_id = 'docs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "docs delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'docs' and (storage.foldername(name))[1] = auth.uid()::text);
