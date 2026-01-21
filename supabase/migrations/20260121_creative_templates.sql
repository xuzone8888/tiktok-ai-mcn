-- Create creative_templates table
create table if not exists public.creative_templates (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  description text,
  type text not null check (type in ('video_batch', 'image_batch')),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Enable RLS
alter table public.creative_templates enable row level security;

-- Create policies
create policy "Users can view their own templates"
  on public.creative_templates for select
  using (auth.uid() = user_id);

create policy "Users can insert their own templates"
  on public.creative_templates for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own templates"
  on public.creative_templates for update
  using (auth.uid() = user_id);

create policy "Users can delete their own templates"
  on public.creative_templates for delete
  using (auth.uid() = user_id);

-- Create index
create index if not exists creative_templates_user_id_idx on public.creative_templates(user_id);
create index if not exists creative_templates_type_idx on public.creative_templates(type);
