-- Supabase Auth が発行する UUID を各使用者のIDとして使います。
-- 1問につき1行を保存し、英文本文や入力した回答文は保存しません。
create table if not exists public.sentence_test_answers (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sentence_id text not null,
  section smallint not null check (section between 1 and 40),
  item_number smallint not null check (item_number between 1 and 15),
  sentence_number smallint generated always as (((section - 1) * 15) + item_number) stored,
  order_mode text not null check (order_mode in ('random', 'weak')),
  answer_mode text not null check (answer_mode in ('write', 'sort', 'blank')),
  is_correct boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists sentence_test_answers_user_date_idx
  on public.sentence_test_answers (user_id, created_at desc);
create index if not exists sentence_test_answers_user_sentence_idx
  on public.sentence_test_answers (user_id, sentence_id, created_at desc);
create index if not exists sentence_test_answers_test_idx
  on public.sentence_test_answers (test_id);

alter table public.sentence_test_answers enable row level security;

drop policy if exists "Users read own sentence answers" on public.sentence_test_answers;
create policy "Users read own sentence answers"
  on public.sentence_test_answers for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users insert own sentence answers" on public.sentence_test_answers;
create policy "Users insert own sentence answers"
  on public.sentence_test_answers for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- 編集・削除はクライアントから許可しません。
revoke all on public.sentence_test_answers from anon;
grant select, insert on public.sentence_test_answers to authenticated;

-- 利用者ごとの表示名をログインIDと分けて管理します。
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  login_id text not null unique,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

insert into public.user_profiles (user_id, login_id, display_name, created_at)
select id, lower(split_part(email, '@', 1)), '', created_at from auth.users where email is not null
on conflict (user_id) do nothing;

alter table public.user_profiles enable row level security;
drop policy if exists "Users read own profile" on public.user_profiles;
create policy "Users read own profile" on public.user_profiles
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users create own profile" on public.user_profiles;
create policy "Users create own profile" on public.user_profiles
  for insert to authenticated with check ((select auth.uid()) = user_id and login_id = split_part((select auth.jwt()->>'email'), '@', 1));
drop policy if exists "Users update own profile" on public.user_profiles;
create policy "Users update own profile" on public.user_profiles
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
revoke all on public.user_profiles from anon;
grant select, insert on public.user_profiles to authenticated;
grant update (display_name) on public.user_profiles to authenticated;
