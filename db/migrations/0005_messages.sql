-- =============================================================================
-- DevUP · 0005 · Mensajería de texto
--
-- Completa el entregable de la semana 1 del plan: dos personas conversando en
-- un canal privado de su organización. Los canales de tipo `text` existían
-- desde 0001; hasta ahora no tenían dónde guardar nada.
--
-- Todo cuelga de `can_access_channel`, que ya sabe de canales privados y de
-- workspaces personales. No hace falta una política nueva por cada caso: la
-- función es el único sitio donde vive esa lógica, y por eso arreglarla en
-- 0004 arregló también lo que se escribiera después.
-- =============================================================================

create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  author_id  uuid references public.users(id) on delete set null,
  body       text not null check (length(btrim(body)) between 1 and 8000),
  -- Responder a un mensaje. `on delete set null` y no cascade: borrar el
  -- mensaje original no debe llevarse por delante las respuestas, que suelen
  -- ser lo que da sentido al hilo.
  reply_to   uuid references public.messages(id) on delete set null,
  -- Un adjunto de la biblioteca. No se duplica el archivo: se apunta al que ya
  -- existe, con sus etiquetas, su URL firmada y sus permisos.
  file_id    uuid references public.files(id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  deleted_at timestamptz
);

create index if not exists messages_channel_idx
  on public.messages (channel_id, created_at desc);

create index if not exists messages_reply_idx on public.messages (reply_to);

-- Aquí sí conviene el lematizador español, al revés que en los archivos: esto
-- es prosa. Buscar «reunión» tiene que encontrar «reuniones», y buscar
-- «desplegamos» tiene que encontrar «desplegar». En los nombres de archivo ese
-- mismo lematizador destrozaba cosas como "informe-Q3-final", y por eso allí
-- se usa `simple`.
create index if not exists messages_search_idx on public.messages
  using gin (to_tsvector('spanish', body));

-- ---------------------------------------------------------------------------
-- Marcas de lectura
--
-- Se guarda una marca de tiempo por persona y canal, no un estado por mensaje.
-- Con «leído hasta aquí» basta para pintar los no leídos y cuesta una fila por
-- canal en vez de una por mensaje y persona, que es la diferencia entre miles
-- de filas y millones.
-- ---------------------------------------------------------------------------
create table if not exists public.channel_reads (
  channel_id   uuid not null references public.channels(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------------
alter table public.messages      enable row level security;
alter table public.channel_reads enable row level security;

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select
  using (public.can_access_channel(channel_id));

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert
  with check (
    public.can_access_channel(channel_id)
    and author_id = public.current_user_id()
  );

-- Editar, solo el autor. Editar el mensaje de otro es poner palabras en su
-- boca, y ningún rol debería poder hacerlo.
drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages for update
  using (author_id = public.current_user_id())
  with check (author_id = public.current_user_id());

-- Borrar, el autor o quien administre la organización: moderar sí es una
-- función legítima de quien administra.
drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages for delete
  using (
    author_id = public.current_user_id()
    or public.is_org_admin(public.org_of_channel(channel_id))
  );

drop policy if exists channel_reads_select on public.channel_reads;
create policy channel_reads_select on public.channel_reads for select
  using (user_id = public.current_user_id());

drop policy if exists channel_reads_insert on public.channel_reads;
create policy channel_reads_insert on public.channel_reads for insert
  with check (
    user_id = public.current_user_id()
    and public.can_access_channel(channel_id)
  );

drop policy if exists channel_reads_update on public.channel_reads;
create policy channel_reads_update on public.channel_reads for update
  using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id());

-- ---------------------------------------------------------------------------
-- No leídos por canal de un workspace
--
-- En una consulta en vez de una por canal. Va en la base y no en la API porque
-- contar mensajes posteriores a una marca es exactamente lo que Postgres hace
-- bien, y traerse los mensajes para contarlos en JavaScript sería traerse la
-- conversación entera para tirarla.
-- ---------------------------------------------------------------------------
create or replace function public.unread_counts(_workspace uuid)
returns table (channel_id uuid, unread bigint)
language sql
stable
as $$
  select c.id,
         count(m.id) filter (
           where m.deleted_at is null
             and m.author_id is distinct from public.current_user_id()
             and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
         )
    from public.channels c
    left join public.channel_reads r
      on r.channel_id = c.id and r.user_id = public.current_user_id()
    left join public.messages m on m.channel_id = c.id
   where c.workspace_id = _workspace
   group by c.id;
$$;

-- Sin SECURITY DEFINER a propósito: al correr con los privilegios de quien
-- llama, las políticas de `channels` y `messages` se le aplican y un canal que
-- no puede ver no aparece en el resultado. Ponerle SECURITY DEFINER para
-- «arreglar» un recuento que sale a cero filtraría la existencia de canales
-- privados ajenos.

-- ---------------------------------------------------------------------------
-- Marcar un canal como leído hasta ahora.
-- ---------------------------------------------------------------------------
create or replace function public.mark_channel_read(_channel uuid)
returns void
language sql
volatile
as $$
  insert into public.channel_reads (channel_id, user_id, last_read_at)
  values (_channel, public.current_user_id(), now())
  on conflict (channel_id, user_id) do update set last_read_at = now();
$$;
