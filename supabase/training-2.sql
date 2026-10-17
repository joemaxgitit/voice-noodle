-- ============================================================
-- Training Hub, round 2: knowledge checks, assignments linked to
-- script practice and practice calls, and new-hire tracks.
-- Run after training.sql. Safe to run more than once.
-- ============================================================

-- 1. New kinds of material.
--    quiz     = a knowledge check, graded on the server
--    module   = a script section in the karaoke trainer
--    practice = a practice call with one of the mock clients
alter table public.training_materials drop constraint if exists training_materials_kind_check;
alter table public.training_materials
  add constraint training_materials_kind_check
  check (kind in ('video','pdf','doc','slides','link','quiz','module','practice'));

alter table public.training_materials add column if not exists module_id  uuid references public.modules(id) on delete set null;
alter table public.training_materials add column if not exists persona_id uuid references public.roleplay_personas(id) on delete set null;
alter table public.training_materials add column if not exists pass_pct   integer not null default 80 check (pass_pct between 1 and 100);
alter table public.training_materials add column if not exists min_score  integer check (min_score is null or min_score between 0 and 100);

-- 2. Knowledge-check questions. Managers only: reps never read the answers.
create table if not exists public.training_quiz_questions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  material_id uuid not null references public.training_materials(id) on delete cascade,
  position    integer not null default 0,
  prompt      text not null,
  options     jsonb not null,          -- ["choice A", "choice B", ...]
  correct     smallint not null,       -- index into options
  explain     text
);
create index if not exists training_quiz_questions_idx on public.training_quiz_questions(material_id, position);

create table if not exists public.training_quiz_attempts (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  material_id uuid not null references public.training_materials(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  version     integer not null,
  score       integer not null,
  passed      boolean not null,
  answers     jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists training_quiz_attempts_idx on public.training_quiz_attempts(material_id, user_id, created_at desc);

-- 3. Tracks: a set of materials, each due N days after a rep starts.
create table if not exists public.training_tracks (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  title       text not null,
  description text,
  archived    boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.training_track_items (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  track_id    uuid not null references public.training_tracks(id) on delete cascade,
  material_id uuid not null references public.training_materials(id) on delete cascade,
  day_offset  integer not null default 0 check (day_offset between 0 and 365),
  position    integer not null default 0
);
create index if not exists training_track_items_idx on public.training_track_items(track_id, position);

create table if not exists public.training_enrollments (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  track_id    uuid not null references public.training_tracks(id) on delete cascade,
  rep_id      uuid not null references public.profiles(id) on delete cascade,
  start_date  date not null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (track_id, rep_id)
);

-- 4. Row-level security.
alter table public.training_quiz_questions enable row level security;
alter table public.training_quiz_attempts  enable row level security;
alter table public.training_tracks         enable row level security;
alter table public.training_track_items    enable row level security;
alter table public.training_enrollments    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['training_quiz_questions','training_quiz_attempts','training_tracks',
                           'training_track_items','training_enrollments']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.is_admin() and org_id = public.my_org_id())
         with check (public.is_admin() and org_id = public.my_org_id())',
      t || '_admin', t);
  end loop;
end $$;

drop policy if exists training_quiz_attempts_own on public.training_quiz_attempts;
create policy training_quiz_attempts_own on public.training_quiz_attempts for select to authenticated
using (user_id = auth.uid());

drop policy if exists training_enrollments_own on public.training_enrollments;
create policy training_enrollments_own on public.training_enrollments for select to authenticated
using (rep_id = auth.uid());

drop policy if exists training_tracks_read on public.training_tracks;
create policy training_tracks_read on public.training_tracks for select to authenticated
using (org_id = public.my_org_id());

drop policy if exists training_track_items_read on public.training_track_items;
create policy training_track_items_read on public.training_track_items for select to authenticated
using (org_id = public.my_org_id());

-- 5. A knowledge check, without its answers.
create or replace function public.training_quiz_for(p_material uuid)
returns table (id uuid, qpos integer, prompt text, options jsonb)
language sql stable security definer set search_path = public as $$
  select q.id, q.position, q.prompt, q.options
  from public.training_quiz_questions q
  join public.training_materials m on m.id = q.material_id
  where q.material_id = p_material
    and m.org_id = public.my_org_id()
    and (m.published or public.is_admin())
  order by q.position;
$$;
grant execute on function public.training_quiz_for(uuid) to authenticated;

-- Grade an attempt on the server. p_answers: {"<question id>": <option index>}.
create or replace function public.training_quiz_submit(p_material uuid, p_answers jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.training_materials;
  total integer;
  right_n integer;
  v_pct integer;
  v_ok boolean;
  results jsonb;
begin
  select * into m from public.training_materials
  where id = p_material and org_id = public.my_org_id() and kind = 'quiz' and (published or public.is_admin());
  if not found then raise exception 'not found'; end if;

  select count(*),
         count(*) filter (where (p_answers ->> q.id::text)::int = q.correct),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id,
           'chosen', (p_answers ->> q.id::text)::int,
           'correct', q.correct,
           'right', (p_answers ->> q.id::text)::int = q.correct,
           'explain', q.explain) order by q.position), '[]'::jsonb)
    into total, right_n, results
  from public.training_quiz_questions q
  where q.material_id = p_material;

  if total = 0 then raise exception 'this knowledge check has no questions yet'; end if;
  v_pct := round(100.0 * right_n / total);
  v_ok := v_pct >= m.pass_pct;

  insert into public.training_quiz_attempts (org_id, material_id, user_id, version, score, passed, answers)
  values (m.org_id, m.id, auth.uid(), m.version, v_pct, v_ok, p_answers);

  insert into public.training_progress (material_id, user_id, org_id, version, pct, completed_at)
  values (m.id, auth.uid(), m.org_id, m.version, v_pct, case when v_ok then now() end)
  on conflict (material_id, user_id) do update set
    version = m.version,
    pct = greatest(case when public.training_progress.version = m.version then public.training_progress.pct else 0 end, excluded.pct),
    completed_at = case
      when public.training_progress.version = m.version and public.training_progress.completed_at is not null
        then public.training_progress.completed_at
      when v_ok then now() end,
    updated_at = now();

  return jsonb_build_object('score', v_pct, 'passed', v_ok, 'pass_pct', m.pass_pct, 'results', results);
end;
$$;
grant execute on function public.training_quiz_submit(uuid, jsonb) to authenticated;

-- Script-practice and practice-call assignments complete themselves from
-- what the rep has actually done. Called when My Training opens.
create or replace function public.training_sync_links()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  m record;
  n integer := 0;
  done boolean;
begin
  for m in
    select * from public.training_materials
    where org_id = public.my_org_id() and published and kind in ('module','practice')
  loop
    if exists (select 1 from public.training_progress p
               where p.material_id = m.id and p.user_id = auth.uid() and p.version = m.version and p.completed_at is not null) then
      continue;
    end if;
    done := false;
    if m.kind = 'module' and m.module_id is not null then
      select count(*) > 0 and count(*) = count(pr.segment_id) into done
      from public.segments s
      left join public.progress pr on pr.segment_id = s.id and pr.user_id = auth.uid() and pr.completed
      where s.module_id = m.module_id and s.active;
    elsif m.kind = 'practice' and m.persona_id is not null then
      select exists (
        select 1 from public.calls c
        where c.source = 'roleplay' and c.rep_id = auth.uid() and c.persona_id = m.persona_id
          and c.status = 'graded' and (m.min_score is null or coalesce(c.slp_score, 0) >= m.min_score)
      ) into done;
    end if;
    if done then
      insert into public.training_progress (material_id, user_id, org_id, version, pct, completed_at)
      values (m.id, auth.uid(), m.org_id, m.version, 100, now())
      on conflict (material_id, user_id) do update
        set version = excluded.version, pct = 100, completed_at = now(), updated_at = now();
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
grant execute on function public.training_sync_links() to authenticated;

-- "I've read it" is only for documents and links.
create or replace function public.training_acknowledge(p_material uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare m public.training_materials;
begin
  select * into m from public.training_materials
  where id = p_material and org_id = public.my_org_id() and (published or public.is_admin());
  if not found then raise exception 'not found'; end if;
  if m.kind not in ('pdf','doc','slides','link') then raise exception 'this kind of training is completed by doing it'; end if;
  insert into public.training_progress (material_id, user_id, org_id, version, pct, completed_at)
  values (p_material, auth.uid(), m.org_id, m.version, 100, now())
  on conflict (material_id, user_id) do update
    set pct = 100, version = m.version,
        completed_at = coalesce(public.training_progress.completed_at, now()), updated_at = now();
end;
$$;

-- 6. A first knowledge check, from "Probing, Hardship, and Gathering
--    Intelligence". Starts unpublished: review it, then publish.
do $$
declare
  o uuid;
  t uuid;
  mid uuid;
begin
  select id into o from public.orgs where slug = 'lionside';
  if o is null then return; end if;
  if exists (select 1 from public.training_materials where org_id = o and kind = 'quiz' and title = 'Knowledge check: Hardship probing questions') then
    return;
  end if;
  select id into t from public.training_topics where org_id = o and lower(title) = 'hardship probing questions';
  insert into public.training_materials (org_id, topic_id, title, description, kind, published, pass_pct)
  values (o, t, 'Knowledge check: Hardship probing questions',
          'Eight questions on finding the pain, the debt and credit questions, future pacing and the co-applicant.',
          'quiz', false, 75)
  returning id into mid;

  insert into public.training_quiz_questions (org_id, material_id, position, prompt, options, correct, explain) values
  (o, mid, 1, 'The client''s score used to be higher and they had less debt. What is the best opening probe?',
   '["What are your interest rates?", "If you don''t mind, could you tell me what happened?", "Would you like to hear about our program?", "Have you tried paying more than the minimum?"]', 1,
   'Start with what happened. It opens the story and the pain before any numbers.'),
  (o, mid, 2, 'Which question is a "Finding Pain" question?',
   '["Do you make minimum payments or do you try to send more?", "How is it affecting your family?", "What was your credit score when you were proud of it?", "Are they carrying the same kind of debt?"]', 1,
   'Stress, family and health questions find the pain. Minimum payments is a debt question; the proud credit score is a credit question.'),
  (o, mid, 3, '"What would you be doing if you weren''t sending $xxx to these bills every month?" is meant to:',
   '["Find out their exact monthly budget", "Get them to picture life without the debt", "Check whether they can afford the program", "Confirm their income"]', 1,
   'It makes the cost of staying where they are real by having them picture what they could be doing instead.'),
  (o, mid, 4, 'Which of these is a debt and payment question?',
   '["Do you feel like they nickel and dime you to death with fees?", "How long has this been going on?", "Do you handle all your financial decisions yourself?", "Are you planning to buy a home in the next 2 years?"]', 0,
   'Fees, interest and minimum payments are the debt and payment questions.'),
  (o, mid, 5, '"Are you planning to purchase a car or a home within the next 2 years?" belongs to which group?',
   '["Finding pain", "Co-app probing", "Future pacing and goals", "Credit related"]', 2,
   'It is future pacing: tying the program to a goal the client already has.'),
  (o, mid, 6, 'The client says there is another income in the household. Which follow-up comes from the co-app questions?',
   '["Would they be open to adding their name to the application?", "What is your stress level like?", "Have you applied for other loans?", "Do you see the balances going down?"]', 0,
   'Co-app probing: is there another income, are they carrying the same debt, would they add their name, what is their credit like, do you decide together.'),
  (o, mid, 7, '"Are you looking to get out of debt as fast as you can, or are you trying to get the lowest payment possible?" helps you learn:',
   '["Their credit score", "What matters most to them, so you know what to lead with", "Whether they qualify for the loan", "Their total balance"]', 1,
   'It tells you which goal to build the options around.'),
  (o, mid, 8, 'Most of the cards were opened around the same month. What does the guide say to ask?',
   '["Nothing -- it''s not relevant", "Was there something that happened around that time?", "Why did you open so many cards?", "Can you close some of them?"]', 1,
   'A cluster of new accounts usually marks a hardship. Ask what happened then.');
end $$;

-- 7. Check: should return 5 tables, then 1 knowledge check with 8 questions.
select table_name from information_schema.tables
where table_schema = 'public' and table_name in ('training_quiz_questions','training_quiz_attempts','training_tracks','training_track_items','training_enrollments')
order by 1;
select m.title, count(q.id) as questions
from public.training_materials m left join public.training_quiz_questions q on q.material_id = m.id
where m.kind = 'quiz' group by m.title;
