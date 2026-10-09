-- DailyPulse: limit join-code guessing.
--
-- From the security review: anyone signed in, including an anonymous user,
-- could call redeem_invite as often as they liked and eventually guess an
-- active code. Now each account gets 10 wrong codes an hour. A wrong code is
-- recorded and the function returns null instead of raising an error, so the
-- record is kept. Supabase also limits how many anonymous accounts one IP
-- address can create each hour, which caps guessing through fresh accounts.

create table public.invite_attempts (
  user_id uuid not null,
  attempted_at timestamptz not null default now()
);

create index invite_attempts_user_idx on public.invite_attempts (user_id, attempted_at);

alter table public.invite_attempts enable row level security;
revoke all on public.invite_attempts from anon, authenticated;

-- Same as before, except: too many wrong codes in the last hour raises an
-- error, and a wrong or expired code returns null.
create or replace function public.redeem_invite(p_code text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_invite public.invites%rowtype;
  v_existing public.member_status;
begin
  if v_uid is null then
    raise exception 'Sign in first.';
  end if;

  if (
    select count(*) from public.invite_attempts
    where user_id = v_uid and attempted_at > now() - interval '1 hour'
  ) >= 10 then
    raise exception 'Too many codes tried. Wait an hour, or ask for a new code.';
  end if;

  select * into v_invite
  from public.invites
  where code = upper(btrim(p_code))
  for update;

  if not found or v_invite.redeemed_at is not null or v_invite.expires_at < now() then
    insert into public.invite_attempts (user_id) values (v_uid);
    return null;
  end if;

  insert into public.profiles (id, display_name)
  values (v_uid, p_display_name)
  on conflict (id) do update set display_name = excluded.display_name;

  select status into v_existing
  from public.circle_members
  where circle_id = v_invite.circle_id and user_id = v_uid;

  if found and v_existing <> 'removed' then
    raise exception 'You are already in this circle.';
  end if;

  begin
    if found then
      update public.circle_members
      set role = v_invite.role, status = 'pending', joined_at = now(), approved_at = null
      where circle_id = v_invite.circle_id and user_id = v_uid;
    else
      insert into public.circle_members (circle_id, user_id, role, status)
      values (v_invite.circle_id, v_uid, v_invite.role, 'pending');
    end if;
  exception when unique_violation then
    raise exception 'This circle already has a parent.';
  end;

  update public.invites
  set redeemed_by = v_uid, redeemed_at = now()
  where code = v_invite.code;

  return v_invite.circle_id;
end;
$$;

revoke execute on function public.redeem_invite(text, text) from public, anon;
grant execute on function public.redeem_invite(text, text) to authenticated;
