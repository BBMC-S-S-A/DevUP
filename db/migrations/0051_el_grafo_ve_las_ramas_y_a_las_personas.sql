-- =============================================================================
-- DevUP · 0051 · El grafo ve las ramas y a las personas
--
-- La 0050 añadió `area` y `persona` al enum de tipos de nodo. Esto les enseña a
-- `puede_ver_nodo` qué significan — y hasta que no lo sepa, **no sirven de
-- nada**: la función no tiene `else`, así que un tipo que nadie enseñó a
-- comprobar da NULL, el `coalesce` lo vuelve `false`, y las políticas de
-- `graph_links` esconden cualquier enlace que los toque. Silenciosamente, que
-- es como está diseñado a propósito: un nodo desconocido no se ve.
--
-- VA EN MIGRACIÓN APARTE POR UNA REGLA DE POSTGRES, no por orden. Un valor de
-- enum no se puede usar en la misma transacción en la que se añadió, y el
-- runner envuelve cada migración en una. Nombrar aquí `'area'` habría hecho
-- fallar la 0050 con un error que no se parece en nada a su causa.
--
-- ─────────────────────────────────────────────────────────────────────────────
--
-- UN ÁREA SE VE SI SE VE SU ESPACIO. Es lo mismo que ya se hace con la tarea,
-- el archivo o el componente: la rama no tiene frontera propia, la hereda del
-- tablero donde vive.
--
-- UNA PERSONA SE VE SI SE COMPARTE ALGUNA ORGANIZACIÓN CON ELLA, que es
-- exactamente la regla que ya usa `profiles`. Se repite aquí en vez de llamar a
-- una función porque no hay ninguna que lo envuelva — y si algún día la hay,
-- este es uno de los dos sitios a cambiar.
--
-- **Y esto importa más que los otros siete tipos juntos.** Un enlace hacia una
-- persona dice de qué sabe alguien, en qué anduvo, con quién trabajó. Si la
-- frontera fuera más ancha que la de `profiles`, el grafo se convertiría en la
-- puerta de atrás por la que se averigua quién trabaja en otra empresa: basta
-- con que un enlace hacia esa persona sea visible para saber que existe. Por eso
-- la regla es la misma, letra por letra.
-- =============================================================================

create or replace function public.puede_ver_nodo(_tipo public.graph_node_kind, _id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    case _tipo
      when 'espacio' then public.can_access_workspace(_id)
      when 'canal'   then public.can_access_channel(_id)
      when 'mensaje' then (
        select public.can_access_channel(m.channel_id) from public.messages m where m.id = _id
      )
      when 'tarea' then (
        select public.can_access_workspace(t.workspace_id) from public.tasks t where t.id = _id
      )
      when 'archivo' then (
        select public.can_access_workspace(f.workspace_id) from public.files f where f.id = _id
      )
      when 'componente' then (
        select public.can_access_workspace(n.workspace_id)
          from public.architecture_nodes n where n.id = _id
      )
      when 'repositorio' then (
        select public.can_access_workspace(r.workspace_id)
          from public.github_repos r where r.id = _id
      )
      when 'entorno' then (
        select public.can_access_workspace(e.workspace_id)
          from public.environments e where e.id = _id
      )

      -- Nuevos en la 0050.
      when 'area' then (
        select public.can_access_workspace(c.workspace_id)
          from public.task_categories c where c.id = _id
      )
      -- La misma regla que `profiles_select`, letra por letra. Ver la cabecera.
      when 'persona' then exists (
        select 1
          from public.organization_members mia
          join public.organization_members suya
            on suya.organization_id = mia.organization_id
         where mia.user_id = public.current_user_id()
           and suya.user_id = _id
      )
      -- Sigue sin `else`: un tipo nuevo cae aquí, el `case` da NULL y el
      -- `coalesce` lo convierte en `false`. Lo que nadie enseñó a comprobar no
      -- se ve, que es la decisión de 0043 y sigue siendo la correcta.
    end,
    false
  );
$$;
