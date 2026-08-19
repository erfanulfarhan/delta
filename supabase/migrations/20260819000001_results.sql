-- Results storage for Delta.
--
-- Access model, and the reasoning behind it:
--   * anyone may INSERT a result (there are no accounts)
--   * nobody may SELECT the table directly
--   * a single result is readable only through get_result(short_id)
--
-- The third point is the whole design. A naive `for select using (true)` policy
-- would make every result anyone ever ran enumerable by any visitor, along with
-- their ISP and city. Routing reads through an accessor means possession of the
-- id is what grants access, which is what a share link is supposed to mean.

create schema if not exists private;

create table public.results (
  -- Identity PK for index locality; random text keys fragment the index.
  id bigint generated always as identity primary key,

  -- The public handle, used in share URLs. Unguessable, so it is the capability.
  short_id text not null unique,

  created_at timestamptz not null default now(),

  mode text not null check (mode in ('bdix', 'raw', 'both')),

  bdix_down numeric(10, 2),
  bdix_up numeric(10, 2),
  bdix_ping numeric(10, 2),
  bdix_jitter numeric(10, 2),

  raw_down numeric(10, 2),
  raw_up numeric(10, 2),
  raw_ping numeric(10, 2),
  raw_jitter numeric(10, 2),

  isp text,
  asn text,
  city text,
  country text,

  -- Set only once the endpoint's signed byte-count token has been checked.
  -- Aggregates must never count an unverified row. Phase 6 populates this.
  verified boolean not null default false,

  -- Plausibility bounds. These do not stop a determined forger, which is what
  -- verification is for, but they cost nothing and keep obvious garbage out of
  -- the table rather than out of the aggregate.
  constraint results_speeds_plausible check (
    coalesce(bdix_down, 0) between 0 and 10000 and
    coalesce(bdix_up, 0) between 0 and 10000 and
    coalesce(raw_down, 0) between 0 and 10000 and
    coalesce(raw_up, 0) between 0 and 10000
  ),
  constraint results_latency_plausible check (
    coalesce(bdix_ping, 0) between 0 and 60000 and
    coalesce(raw_ping, 0) between 0 and 60000
  ),
  -- A 'both' run without both sides is not a comparison.
  constraint results_both_has_both check (
    mode <> 'both' or (bdix_down is not null and raw_down is not null)
  )
);

-- Lookup path for the accessor function.
create unique index results_short_id_idx on public.results (short_id);

-- Leaderboard aggregates group by ISP over a recent window and only ever count
-- verified rows, so the index matches that access pattern exactly.
create index results_isp_verified_idx on public.results (isp, created_at desc)
  where verified;

alter table public.results enable row level security;
alter table public.results force row level security;

-- Anonymous insert is intentional: the product has no accounts.
create policy results_anon_insert on public.results
  for insert
  to anon, authenticated
  with check (true);

-- No SELECT policy exists, deliberately. With RLS enabled and no policy, direct
-- reads return nothing for every role. Reads go through get_result below.

/**
 * Read one result by its share id.
 *
 * SECURITY DEFINER so it can bypass the absent SELECT policy. There is no
 * auth.uid() check here and that is correct rather than an oversight: these
 * rows are deliberately public, and the short_id is the capability. The
 * function is narrow, returns exactly one row, and exposes no way to enumerate.
 */
create or replace function public.get_result(p_short_id text)
returns table (
  short_id text,
  created_at timestamptz,
  mode text,
  bdix_down numeric,
  bdix_up numeric,
  bdix_ping numeric,
  bdix_jitter numeric,
  raw_down numeric,
  raw_up numeric,
  raw_ping numeric,
  raw_jitter numeric,
  isp text,
  city text,
  country text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.short_id, r.created_at, r.mode,
    r.bdix_down, r.bdix_up, r.bdix_ping, r.bdix_jitter,
    r.raw_down, r.raw_up, r.raw_ping, r.raw_jitter,
    r.isp, r.city, r.country
  from public.results r
  where r.short_id = p_short_id
  limit 1;
$$;

-- asn is deliberately absent from the return type above: it adds nothing for a
-- viewer and narrows the network a shared link points at.

revoke all on function public.get_result(text) from public;
grant execute on function public.get_result(text) to anon, authenticated;

-- Least privilege on the table itself: insert only, and no access to the
-- identity sequence beyond what insert needs.
revoke all on table public.results from anon, authenticated;
grant insert on table public.results to anon, authenticated;
