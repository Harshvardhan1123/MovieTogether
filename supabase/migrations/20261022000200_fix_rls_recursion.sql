-- Break the rooms <-> room_members RLS policy cycle.
-- These helpers run with their owner's permissions and are only called by RLS.
create or replace function private.is_room_host(target_room_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.rooms
    where id = target_room_id
      and host_id = target_user_id
  );
$$;

create or replace function private.is_approved_room_member(target_room_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.room_members
    where room_id = target_room_id
      and user_id = target_user_id
      and status = 'approved'
  );
$$;

create or replace function private.is_room_member(target_room_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.room_members
    where room_id = target_room_id
      and user_id = target_user_id
      and status in ('pending', 'approved')
  );
$$;

create or replace function private.lookup_active_room_by_code(target_room_code text)
returns table(id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select rooms.id
  from public.rooms
  where rooms.room_code = upper(trim(target_room_code))
    and rooms.status = 'active'
  limit 1;
$$;

create or replace function public.lookup_active_room_by_code(target_room_code text)
returns table(id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select rooms.id
  from public.rooms
  where rooms.room_code = upper(trim(target_room_code))
    and rooms.status = 'active'
  limit 1;
$$;

alter function public.lookup_active_room_by_code(text) security definer;
alter function private.lookup_active_room_by_code(text) security definer;

grant usage on schema private to authenticated;
revoke all on function private.is_room_host(uuid, uuid) from public;
revoke all on function private.is_approved_room_member(uuid, uuid) from public;
revoke all on function private.is_room_member(uuid, uuid) from public;
revoke all on function private.lookup_active_room_by_code(text) from public;
grant execute on function private.is_room_host(uuid, uuid) to authenticated;
grant execute on function private.is_approved_room_member(uuid, uuid) to authenticated;
grant execute on function private.is_room_member(uuid, uuid) to authenticated;
revoke all on function public.lookup_active_room_by_code(text) from public;
grant execute on function public.lookup_active_room_by_code(text) to authenticated;

drop policy if exists "members can view their rooms" on public.rooms;
create policy "members can view their rooms"
  on public.rooms for select to authenticated
  using (
    host_id = (select auth.uid())
    or private.is_room_member(id, (select auth.uid()))
  );

drop policy if exists "hosts delete their rooms" on public.rooms;
create policy "hosts delete their rooms"
  on public.rooms for delete to authenticated
  using (host_id = (select auth.uid()));

drop policy if exists "members can view room membership" on public.room_members;
create policy "members can view room membership"
  on public.room_members for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.is_room_host(room_id, (select auth.uid()))
  );

drop policy if exists "hosts manage membership" on public.room_members;
create policy "hosts manage membership"
  on public.room_members for update to authenticated
  using (private.is_room_host(room_id, (select auth.uid())))
  with check (private.is_room_host(room_id, (select auth.uid())));

drop policy if exists "users request membership" on public.room_members;
create policy "users request membership"
  on public.room_members for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and role = 'member'
    and status = 'pending'
  );

drop policy if exists "members can read room chat" on public.chat_messages;
create policy "members can read room chat"
  on public.chat_messages for select to authenticated
  using (private.is_approved_room_member(room_id, (select auth.uid())));

drop policy if exists "members can send room chat" on public.chat_messages;
create policy "members can send room chat"
  on public.chat_messages for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and private.is_approved_room_member(room_id, (select auth.uid()))
  );

drop policy if exists "members can read playback" on public.playback_state;
create policy "members can read playback"
  on public.playback_state for select to authenticated
  using (private.is_approved_room_member(room_id, (select auth.uid())));

drop policy if exists "hosts control playback" on public.playback_state;
create policy "hosts control playback"
  on public.playback_state for all to authenticated
  using (private.is_room_host(room_id, (select auth.uid())))
  with check (private.is_room_host(room_id, (select auth.uid())));

-- Keep the RPC callable after an interrupted or partially applied migration.
grant usage on schema private to authenticated;
grant execute on function private.lookup_active_room_by_code(text) to authenticated;
grant execute on function public.lookup_active_room_by_code(text) to authenticated;
grant execute on function public.lookup_active_room_by_code(text) to authenticated;

select pg_notify('pgrst', 'reload schema');
