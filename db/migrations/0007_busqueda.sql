-- =============================================================================
-- DevUP · 0007 · Búsqueda global
--
-- Buscar en un sitio y encontrar el mensaje, el archivo o la tarea. Es la
-- semana 6 del plan y el momento en que la herramienta empieza a competir con
-- las que el equipo ya usa: mientras haya que recordar en cuál de las tres
-- cosas estaba aquello, se sigue buscando en Slack.
--
-- LA FUNCIÓN NO ES `SECURITY DEFINER`, Y ESO ES EL DISEÑO, NO UN OLVIDO.
-- Al correr con los privilegios de quien llama, RLS se le aplica: los mensajes
-- de un canal privado ajeno, los archivos de un workspace personal de otro y
-- las tareas de una organización que no es la suya no aparecen, sin que haya
-- que escribir un solo filtro. Ponerle SECURITY DEFINER para «arreglar» un
-- resultado vacío convertiría la caja de búsqueda en la mayor fuga del
-- producto: un buscador de contenido ajeno.
-- =============================================================================

-- Las tareas no tenían índice de texto: hasta ahora no se buscaban.
create index if not exists tasks_search_idx on public.tasks
  using gin (to_tsvector('spanish', coalesce(title, '') || ' ' || coalesce(description, '')));

create or replace function public.search_everything(
  _organization uuid,
  _query        text,
  _limit        int default 30
)
returns table (
  kind           text,
  id             uuid,
  title          text,
  snippet        text,
  link           text,
  workspace_id   uuid,
  workspace_name text,
  created_at     timestamptz,
  rank           real
)
language sql
stable
as $$
  with entrada as (
    select
      plainto_tsquery('spanish', _query) as consulta_es,
      plainto_tsquery('simple',  _query) as consulta_simple,
      '%' || _query || '%'               as parecido
  ),

  -- Mensajes: prosa, así que lematizador español. Buscar «reunión» encuentra
  -- «reuniones».
  mensajes as (
    select
      'message'::text,
      m.id,
      '#' || c.name,
      left(m.body, 180),
      '/app/w/' || w.id::text || '/c/' || c.id::text,
      w.id,
      w.name,
      m.created_at,
      ts_rank(to_tsvector('spanish', m.body), e.consulta_es)
    from public.messages m
    join public.channels c   on c.id = m.channel_id
    join public.workspaces w on w.id = c.workspace_id
    cross join entrada e
    where w.organization_id = _organization
      and m.deleted_at is null
      and to_tsvector('spanish', m.body) @@ e.consulta_es
  ),

  -- Archivos: `simple` a propósito. Los nombres de archivo son identificadores,
  -- no prosa, y el lematizador español destroza cosas como "informe-Q3-final".
  -- Se añade una coincidencia por subcadena porque quien busca "Q3" espera
  -- encontrarlo dentro de un nombre aunque no sea una palabra suelta.
  archivos as (
    select
      'file'::text,
      f.id,
      f.name,
      left(f.description, 180),
      '/app/w/' || f.workspace_id::text,
      f.workspace_id,
      w.name,
      f.created_at,
      greatest(
        ts_rank(
          to_tsvector('simple', coalesce(f.name, '') || ' ' || coalesce(f.description, '')),
          e.consulta_simple
        ),
        case when f.name ilike e.parecido then 0.05 else 0 end
      )
    from public.files f
    join public.workspaces w on w.id = f.workspace_id
    cross join entrada e
    where f.organization_id = _organization
      and f.deleted_at is null
      and f.status = 'ready'
      and (
        to_tsvector('simple', coalesce(f.name, '') || ' ' || coalesce(f.description, ''))
          @@ e.consulta_simple
        or f.name ilike e.parecido
      )
  ),

  tareas as (
    select
      'task'::text,
      t.id,
      t.title,
      left(t.description, 180),
      '/app/w/' || t.workspace_id::text || '/board',
      t.workspace_id,
      w.name,
      t.created_at,
      ts_rank(
        to_tsvector('spanish', coalesce(t.title, '') || ' ' || coalesce(t.description, '')),
        e.consulta_es
      )
    from public.tasks t
    join public.workspaces w on w.id = t.workspace_id
    cross join entrada e
    where w.organization_id = _organization
      and to_tsvector('spanish', coalesce(t.title, '') || ' ' || coalesce(t.description, ''))
          @@ e.consulta_es
  )

  select * from (
    select * from mensajes
    union all select * from archivos
    union all select * from tareas
  ) todo(kind, id, title, snippet, link, workspace_id, workspace_name, created_at, rank)
  -- El rango de un `simple` y el de un `spanish` no son estrictamente
  -- comparables, así que se desempata por fecha: entre dos cosas igual de
  -- relevantes, casi siempre se busca la más reciente.
  order by rank desc, created_at desc
  limit greatest(1, least(_limit, 100));
$$;
