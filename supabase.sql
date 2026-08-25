-- ===================================================================
-- 최애 청첩장 발급기 — Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여넣고 Run.
-- (여러 번 실행해도 안전하도록 작성됨)
-- ===================================================================

create extension if not exists pgcrypto;

-- -------------------------------------------------------------------
-- 1. 테이블
--    cheer  = 축하합니다
--    sense  = 정신 차리세요
--    donate = 정신머리 기부
-- -------------------------------------------------------------------
create table if not exists public.invitations (
  id           uuid primary key default gen_random_uuid(),
  groom        text not null,
  bride        text not null,
  when_label   text not null,
  place_label  text not null,
  created_at   timestamptz not null default now(),
  cheer        int not null default 0,
  sense        int not null default 0,
  donate       int not null default 0,

  -- 빈 값 · 과도하게 긴 값 차단 (anon 이 INSERT 하므로 DB에서 막는다)
  constraint invitations_groom_len  check (char_length(groom)       between 1 and 24),
  constraint invitations_bride_len  check (char_length(bride)       between 1 and 24),
  constraint invitations_when_len   check (char_length(when_label)  between 1 and 40),
  constraint invitations_place_len  check (char_length(place_label) between 1 and 40)
);

-- -------------------------------------------------------------------
-- 2. INSERT 시 카운터를 강제로 0으로
--    anon 이 cheer/sense/donate 에 임의 초기값을 넣는 것을 막는다.
-- -------------------------------------------------------------------
create or replace function public.invitations_zero_counters()
returns trigger
language plpgsql
as $$
begin
  new.cheer  := 0;
  new.sense  := 0;
  new.donate := 0;
  return new;
end;
$$;

drop trigger if exists trg_invitations_zero_counters on public.invitations;
create trigger trg_invitations_zero_counters
  before insert on public.invitations
  for each row execute function public.invitations_zero_counters();

-- -------------------------------------------------------------------
-- 3. RLS — anon 은 INSERT / SELECT 만.
--    UPDATE·DELETE 정책은 만들지 않는다 → RLS 기본값이 거부이므로
--    anon 키로는 카운터를 직접 수정하거나 행을 지울 수 없다.
--    카운터 증가는 오직 아래 4번 RPC 로만 가능하다.
-- -------------------------------------------------------------------
alter table public.invitations enable row level security;

drop policy if exists "anon can insert invitations" on public.invitations;
create policy "anon can insert invitations"
  on public.invitations for insert
  to anon, authenticated
  with check (true);

drop policy if exists "anon can read invitations" on public.invitations;
create policy "anon can read invitations"
  on public.invitations for select
  to anon, authenticated
  using (true);

-- -------------------------------------------------------------------
-- 4. 반응 +1 RPC
--    security definer 로 RLS를 우회하되, 허용된 3개 컬럼만 +1 한다.
--    다른 컬럼(이름·일시·장소)은 이 함수로 절대 바뀌지 않는다.
--
--    이름 규칙 두 가지가 일부러 이렇게 되어 있다:
--    - 파라미터가 p_id / p_reaction 인 이유: id, reaction_type 을 그대로 쓰면
--      plpgsql 안에서 컬럼명과 충돌해 "ambiguous column reference" 가 난다.
--    - returns table (cheer int, ...) 대신 setof invitations 인 이유: 같은 이유로
--      OUT 파라미터 이름이 컬럼명과 충돌하기 때문. 행 전체를 그대로 돌려준다.
-- -------------------------------------------------------------------
create or replace function public.bump_reaction(p_id uuid, p_reaction text)
returns setof public.invitations
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_reaction not in ('cheer', 'sense', 'donate') then
    raise exception 'invalid reaction: %', p_reaction;
  end if;

  -- UPDATE 를 CTE 로 감싸 SELECT 로 돌려준다(return query 에 가장 안전한 형태)
  return query
  with bumped as (
    update public.invitations as i
       set cheer  = i.cheer  + (p_reaction = 'cheer')::int,
           sense  = i.sense  + (p_reaction = 'sense')::int,
           donate = i.donate + (p_reaction = 'donate')::int
     where i.id = p_id
    returning i.*
  )
  select * from bumped;
end;
$$;

-- 함수 실행 권한도 명시적으로 좁힌다
revoke all on function public.bump_reaction(uuid, text) from public;
grant execute on function public.bump_reaction(uuid, text) to anon, authenticated;

-- ===================================================================
-- 5. [추가] 청첩장 문구 컬럼
--    STEP 03 에서 고른 한마디를 저장한다.
--    이미 만들어진 테이블에도 안전하게 적용되도록 nullable 로 추가하고,
--    값이 없는 기존 행은 앱에서 기본 문구로 대체한다.
--    (스키마를 처음 만드는 경우에도 이 블록까지 함께 실행하면 된다.)
-- ===================================================================
alter table public.invitations
  add column if not exists message_label text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'invitations_message_len'
  ) then
    alter table public.invitations
      add constraint invitations_message_len
      check (message_label is null or char_length(message_label) between 1 and 60);
  end if;
end;
$$;

-- ===================================================================
-- 6. [추가] 대표 사진 컬럼
--    '나'가 신랑이냐 신부냐에 따라 고른 사진을 저장한다.
--    하객이 링크로 열었을 때도 같은 사진이 보여야 하므로 DB에 남긴다.
--    값이 없는 기존 행은 앱에서 기본 사진으로 대체한다.
-- ===================================================================
alter table public.invitations
  add column if not exists photo_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'invitations_photo_key_valid'
  ) then
    alter table public.invitations
      add constraint invitations_photo_key_valid
      check (photo_key is null or photo_key in
        ('wedding-01','wedding-02','wedding-03','wedding-04','wedding-05'));
  end if;
end;
$$;

-- ===================================================================
-- 7. [추가] 캐릭터 전용 사진 키
--    최애 이름이 지정 캐릭터와 일치하면 그 키를 저장한다(없으면 NULL).
--    하객이 링크로 열었을 때도 같은 사진이 보여야 하므로 DB에 남긴다.
--    NULL 이면 앱이 기존 photo_key 로직을 그대로 쓴다.
-- ===================================================================
alter table public.invitations
  add column if not exists character_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'invitations_character_key_valid'
  ) then
    alter table public.invitations
      add constraint invitations_character_key_valid
      check (character_key is null or character_key in
        ('howl','gojo','nanami','levi','loid','tomoe','haku','rengoku'));
  end if;
end;
$$;
