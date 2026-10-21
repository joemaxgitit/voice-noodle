-- Fingerprint of each uploaded recording, so the same audio can't be uploaded twice.
alter table public.calls add column if not exists file_hash text;
create index if not exists calls_file_hash_idx on public.calls (org_id, file_hash);
notify pgrst, 'reload schema';
