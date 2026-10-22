-- A manager can pin a call as a rep's best call (one regular, one Renew).
set lock_timeout = '5s'; -- gives up instead of freezing the app if calls are busy; just run it again
alter table public.calls add column if not exists best_pin boolean not null default false;
notify pgrst, 'reload schema';
