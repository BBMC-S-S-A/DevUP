-- DevUP · 0072 · Comentarios de tarea
--
-- El detalle de una tarea describe qué hay que hacer y no debe cambiar cada
-- vez que alguien añade una nota. Los comentarios son una historia separada:
-- solo se añaden, conservan autor y fecha, y desaparecen con la tarea.

create table if not exists public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  author_id  uuid references public.users(id) on delete set null,
  source     public.activity_source not null default 'persona',
  body       text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists task_comments_task_at_idx
  on public.task_comments (task_id, created_at, id);

alter table public.task_comments enable row level security;

drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select on public.task_comments for select
  using (exists (
    select 1 from public.tasks t where t.id = task_comments.task_id
  ));

drop policy if exists task_comments_insert on public.task_comments;
create policy task_comments_insert on public.task_comments for insert
  with check (
    author_id = public.current_user_id()
    and exists (select 1 from public.tasks t where t.id = task_comments.task_id)
  );

-- No hay políticas de UPDATE ni DELETE: corregir es añadir otro comentario;
-- la historia no se reescribe desde la aplicación.
