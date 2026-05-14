-- Run this in your Supabase SQL Editor

create table programs (
  id uuid default gen_random_uuid() primary key,
  client_id text references clients(id),
  title text not null,
  is_active boolean default true,
  created_at timestamp default now()
);

create table program_days (
  id uuid default gen_random_uuid() primary key,
  program_id uuid references programs(id),
  name text not null,
  theme text,
  day_order integer default 1,
  created_at timestamp default now()
);

create table exercise_blocks (
  id uuid default gen_random_uuid() primary key,
  day_id uuid references program_days(id),
  exercise_name text not null,
  sets text,
  reps text,
  weight text,
  focus text,
  block_type text default 'single',
  notes text,
  block_order integer default 1,
  created_at timestamp default now()
);

create table exercise_logs (
  id uuid default gen_random_uuid() primary key,
  client_id text references clients(id),
  exercise_name text not null,
  date text,
  sets text,
  reps text,
  weight text,
  notes text,
  program_id uuid references programs(id),
  day_id uuid references program_days(id),
  created_at timestamp default now()
);
