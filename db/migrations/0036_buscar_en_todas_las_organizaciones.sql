-- =============================================================================
-- DevUP · 0036 · Buscar en todas las organizaciones
--
-- EL PROBLEMA. `global_search` pedía una organización obligatoria, así que la
-- pantalla de buscar decía «Todo lo de la organización» y quien pertenece a
-- tres tenía que saber de antemano en cuál estaba lo que buscaba — que es
-- justo lo que no se sabe cuando se busca. La única función pensada para
-- encontrar cualquier cosa no podía cruzar la frontera que la gente cruza
-- todos los días.
--
-- POR QUÉ ESTO NO ABRE NADA, Y ES LA PARTE QUE IMPORTA. La 0014 ya dejó
-- escrito que su `where organization_id` estaba ahí «solo para acotar el
-- resultado a la organización correcta, no para protegerlo»: la función no es
-- `security definer`, y el aislamiento lo ponen las políticas de cada tabla a
-- través de `can_access_channel`, `can_access_workspace` e `is_org_member`.
--
-- Así que buscar en todas no es levantar una restricción de seguridad: es
-- DEJAR DE ACOTAR. Quien no pertenece a una organización sigue sin ver una
-- sola de sus filas, exactamente igual que antes y por el mismo motivo — lo
-- decide Postgres, no este `where`. Si alguna vez esta función se volviera
-- `security definer`, este cambio pasaría a ser una fuga: no se haga.
--
-- SE AÑADE DE DÓNDE VIENE CADA RESULTADO. Sin eso, una lista que mezcla tres
-- organizaciones es peor que una que enseña una sola: dos clientes con el
-- mismo nombre en dos empresas distintas serían indistinguibles. Decir la
-- organización es la mitad de la respuesta.
--
-- HAY QUE BORRAR ANTES DE CREAR. `create or replace function` no puede cambiar
-- el tipo de retorno, y aquí la tabla devuelta gana una columna. El `drop` es
-- de la firma vieja y solo de ella.
-- =============================================================================

drop function if exists public.global_search(uuid, text, int);

create function public.global_search(
  -- Nulo significa «todas las mías». No hay valor centinela ni una segunda
  -- función: el filtro simplemente no se aplica, y lo que queda visible lo
  -- sigue decidiendo RLS.
  _organization_id uuid,
  _query text,
  _limit int default 30
)
returns table (
  entity text,
  id uuid,
  title text,
  snippet text,
  organization_id uuid,
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
           w.organization_id,
           c.workspace_id, m.channel_id,
           ts_rank(to_tsvector('spanish', m.body), websearch_to_tsquery('spanish', _query)) as rank,
           m.created_at
      from public.messages m
      join public.channels c on c.id = m.channel_id
      join public.workspaces w on w.id = c.workspace_id
     where (_organization_id is null or w.organization_id = _organization_id)
       and m.deleted_at is null
       and to_tsvector('spanish', m.body) @@ websearch_to_tsquery('spanish', _query)

    union all

    select 'file', f.id, f.name,
           left(coalesce(f.description, ''), 140),
           f.organization_id,
           f.workspace_id, f.channel_id,
           ts_rank(to_tsvector('simple', coalesce(f.name, '') || ' ' || coalesce(f.description, '')),
             websearch_to_tsquery('simple', _query)),
           f.created_at
      from public.files f
     where (_organization_id is null or f.organization_id = _organization_id)
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
           w.organization_id,
           t.workspace_id, null::uuid,
           ts_rank(to_tsvector('spanish', coalesce(t.title, '') || ' ' || coalesce(t.description, '')),
             websearch_to_tsquery('spanish', _query)),
           t.created_at
      from public.tasks t
      join public.workspaces w on w.id = t.workspace_id
     where (_organization_id is null or w.organization_id = _organization_id)
       and to_tsvector('spanish', coalesce(t.title, '') || ' ' || coalesce(t.description, ''))
           @@ websearch_to_tsquery('spanish', _query)

    union all

    select 'client', cl.id, cl.name,
           left(coalesce(cl.notes, ''), 140),
           cl.organization_id,
           null::uuid, null::uuid,
           ts_rank(to_tsvector('simple',
             coalesce(cl.name, '') || ' ' || coalesce(cl.contact_name, '') || ' ' || coalesce(cl.notes, '')),
             websearch_to_tsquery('simple', _query)),
           cl.created_at
      from public.clients cl
     where (_organization_id is null or cl.organization_id = _organization_id)
       and to_tsvector('simple',
             coalesce(cl.name, '') || ' ' || coalesce(cl.contact_name, '') || ' ' || coalesce(cl.notes, ''))
           @@ websearch_to_tsquery('simple', _query)

    union all

    select 'service', s.id, s.name,
           left(coalesce(s.description, ''), 140),
           s.organization_id,
           null::uuid, null::uuid,
           ts_rank(to_tsvector('simple', coalesce(s.name, '') || ' ' || coalesce(s.description, '')),
             websearch_to_tsquery('simple', _query)),
           s.created_at
      from public.services s
     where (_organization_id is null or s.organization_id = _organization_id)
       and to_tsvector('simple', coalesce(s.name, '') || ' ' || coalesce(s.description, ''))
           @@ websearch_to_tsquery('simple', _query)

    union all

    select 'opportunity', o.id, o.title,
           o.stage::text,
           o.organization_id,
           null::uuid, null::uuid,
           ts_rank(to_tsvector('simple', o.title), websearch_to_tsquery('simple', _query)),
           o.created_at
      from public.opportunities o
     where (_organization_id is null or o.organization_id = _organization_id)
       and to_tsvector('simple', o.title) @@ websearch_to_tsquery('simple', _query)
  )
  select * from resultados
   order by rank desc, created_at desc
   limit _limit;
$$;
