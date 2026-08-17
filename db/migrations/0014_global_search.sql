-- =============================================================================
-- DevUP · 0014 · Búsqueda global
--
-- S6 del plan de 12 semanas. Hasta ahora la búsqueda era por workspace
-- (archivos) o no existía (tareas, clientes, servicios, oportunidades).
-- Mensajes y archivos ya tenían su índice de texto completo desde 0002 y
-- 0005; aquí se añaden los que faltan y una función que los une a todos.
--
-- EL IDIOMA DEL DICCIONARIO NO ES ARBITRARIO, sigue el mismo criterio que ya
-- fijó 0002_files.sql: `spanish` para prosa (el lematizador ayuda: buscar
-- "reunión" encuentra "reuniones"), `simple` para nombres propios y
-- catálogos, donde ese mismo lematizador destroza cosas como
-- "informe-Q3-final" o el nombre de un cliente.
--
--   tasks         -> spanish (título y descripción son prosa, como los mensajes)
--   clients       -> simple  (nombres de empresa y notas cortas)
--   services      -> simple  (catálogo, como los archivos)
--   opportunities -> simple  (títulos de venta casi siempre son nombres propios)
--
-- LA FUNCIÓN NO ES SECURITY DEFINER, a propósito, igual que unread_counts en
-- 0005_messages.sql: si saltara RLS para "arreglar" un resultado vacío, un
-- canal privado ajeno se filtraría por la búsqueda antes que por ningún otro
-- sitio. El aislamiento lo siguen poniendo can_access_channel,
-- can_access_workspace e is_org_member a través de las políticas ya
-- existentes sobre cada tabla; el `where organization_id` de más abajo es
-- solo para acotar el resultado a la organización correcta, no para
-- protegerlo — exactamente como ya se hace en sales.ts.
-- =============================================================================

create index if not exists tasks_search_idx on public.tasks
  using gin (to_tsvector('spanish', coalesce(title, '') || ' ' || coalesce(description, '')));

create index if not exists clients_search_idx on public.clients
  using gin (to_tsvector('simple',
    coalesce(name, '') || ' ' || coalesce(contact_name, '') || ' ' || coalesce(notes, '')));

create index if not exists services_search_idx on public.services
  using gin (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(description, '')));

create index if not exists opportunities_search_idx on public.opportunities
  using gin (to_tsvector('simple', title));

create or replace function public.global_search(
  _organization_id uuid,
  _query text,
  _limit int default 30
)
returns table (
  entity text,
  id uuid,
  title text,
  snippet text,
  workspace_id uuid,
  channel_id uuid,
  rank real,
  created_at timestamptz
)
language sql
stable
as $$
  with resultados as (
    select 'message'::text as entity, m.id, left(m.body, 140) as title,
           ''::text as snippet,
           c.workspace_id, m.channel_id,
           ts_rank(to_tsvector('spanish', m.body), websearch_to_tsquery('spanish', _query)) as rank,
           m.created_at
      from public.messages m
      join public.channels c on c.id = m.channel_id
      join public.workspaces w on w.id = c.workspace_id
     where w.organization_id = _organization_id
       and m.deleted_at is null
       and to_tsvector('spanish', m.body) @@ websearch_to_tsquery('spanish', _query)

    union all

    select 'file', f.id, f.name,
           left(coalesce(f.description, ''), 140),
           f.workspace_id, f.channel_id,
           ts_rank(to_tsvector('simple', coalesce(f.name, '') || ' ' || coalesce(f.description, '')),
             websearch_to_tsquery('simple', _query)),
           f.created_at
      from public.files f
     where f.organization_id = _organization_id
       and f.deleted_at is null
       and f.status = 'ready'
       and (
         to_tsvector('simple', coalesce(f.name, '') || ' ' || coalesce(f.description, ''))
             @@ websearch_to_tsquery('simple', _query)
         -- Mismo respaldo que ya usa GET /workspaces/:id/files: un nombre de
         -- archivo con guiones ("secreto-de-ana.png") lo tokeniza `simple`
         -- entero, como una identidad, no como tres palabras — buscar solo
         -- "secreto" no coincide con el tsvector aunque sea justo lo que se
         -- pidió. El ilike encuentra la subcadena donde el vector no la ve.
         or f.name ilike '%' || _query || '%'
       )

    union all

    select 'task', t.id, t.title,
           left(coalesce(t.description, ''), 140),
           t.workspace_id, null::uuid,
           ts_rank(to_tsvector('spanish', coalesce(t.title, '') || ' ' || coalesce(t.description, '')),
             websearch_to_tsquery('spanish', _query)),
           t.created_at
      from public.tasks t
      join public.workspaces w on w.id = t.workspace_id
     where w.organization_id = _organization_id
       and to_tsvector('spanish', coalesce(t.title, '') || ' ' || coalesce(t.description, ''))
           @@ websearch_to_tsquery('spanish', _query)

    union all

    select 'client', cl.id, cl.name,
           left(coalesce(cl.notes, ''), 140),
           null::uuid, null::uuid,
           ts_rank(to_tsvector('simple',
             coalesce(cl.name, '') || ' ' || coalesce(cl.contact_name, '') || ' ' || coalesce(cl.notes, '')),
             websearch_to_tsquery('simple', _query)),
           cl.created_at
      from public.clients cl
     where cl.organization_id = _organization_id
       and to_tsvector('simple',
             coalesce(cl.name, '') || ' ' || coalesce(cl.contact_name, '') || ' ' || coalesce(cl.notes, ''))
           @@ websearch_to_tsquery('simple', _query)

    union all

    select 'service', s.id, s.name,
           left(coalesce(s.description, ''), 140),
           null::uuid, null::uuid,
           ts_rank(to_tsvector('simple', coalesce(s.name, '') || ' ' || coalesce(s.description, '')),
             websearch_to_tsquery('simple', _query)),
           s.created_at
      from public.services s
     where s.organization_id = _organization_id
       and to_tsvector('simple', coalesce(s.name, '') || ' ' || coalesce(s.description, ''))
           @@ websearch_to_tsquery('simple', _query)

    union all

    select 'opportunity', o.id, o.title,
           o.stage::text,
           null::uuid, null::uuid,
           ts_rank(to_tsvector('simple', o.title), websearch_to_tsquery('simple', _query)),
           o.created_at
      from public.opportunities o
     where o.organization_id = _organization_id
       and to_tsvector('simple', o.title) @@ websearch_to_tsquery('simple', _query)
  )
  select * from resultados
   order by rank desc, created_at desc
   limit _limit;
$$;
