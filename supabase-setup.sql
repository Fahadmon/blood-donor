-- Run this once in Supabase: SQL Editor > New query > paste > Run
create table if not exists public.donors (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  age           int  not null,
  location      text not null,
  mobile        text not null,
  email         text not null default '',
  blood_group   text not null,
  last_donated  date,
  created_at    timestamptz not null default now()
);

-- Lock the table so only your server (using the secret key) can read/write it.
alter table public.donors enable row level security;
