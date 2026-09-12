-- =============================================================================
-- DevUP · 0042 · `is_org_admin` no puede devolver NULL
--
-- ESTO ES UN AGUJERO DE AUTORIZACIÓN, no una limpieza. Apareció escribiendo el
-- caso de aislamiento del código corto de invitación (0041): la prueba decía
-- que alguien de fuera NO debía poder fabricar una invitación a una
-- organización ajena, y falló — porque sí podía.
--
-- LA CAUSA, QUE ES DE LAS QUE NO SE VEN LEYENDO EL CÓDIGO:
--
--   is_org_admin(_org) := org_role_of(_org) in ('owner', 'admin')
--
-- `org_role_of` devuelve NULL cuando quien pregunta no es miembro. Y en SQL,
-- `NULL in ('owner','admin')` no es `false`: es NULL. Así que `is_org_admin`
-- devolvía NULL, no `false`.
--
-- Dentro de una política de RLS eso daba igual —un `using` que sale NULL no
-- deja pasar la fila, igual que uno falso—, y por eso el aislamiento de las
-- tablas nunca lo notó. Pero en plpgsql:
--
--   if not public.is_org_admin(_org) then raise exception ... end if;
--
-- `not NULL` es NULL, y una condición NULL **no entra en el `if`**. El guardián
-- no saltaba. Lo comprobado en la base antes de arreglarlo: una persona con
-- sesión que no pertenece a una organización podía crear en ella una invitación
-- de ADMINISTRADOR y aceptársela a sí misma. Entrada completa a los datos de
-- otra empresa, con dos llamadas a la API.
--
-- Solo `is_org_admin` tenía este defecto: `is_org_member`,
-- `can_access_workspace` y `can_access_channel` se escribieron con `exists`, que
-- devuelve `true` o `false` y nunca NULL. Y solo dos funciones lo usaban como
-- guardián en plpgsql —`create_invitation` y `add_member_by_email`—, que son
-- justamente las dos que meten gente en una organización.
--
-- SE ARREGLA EN EL ORIGEN Y NO EN LOS DOS SITIOS QUE LO LLAMAN. Poner un
-- `coalesce` en cada guardián dejaría la trampa armada para el tercero que
-- alguien escriba. En las políticas de RLS no cambia nada: donde antes salía
-- NULL ahora sale `false`, y las dos cierran igual.
-- =============================================================================

create or replace function public.is_org_admin(_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- `coalesce` fuera del `in`: si no eres miembro, `org_role_of` da NULL y esto
  -- tiene que ser `false` —una respuesta— y no NULL, que es «no se sabe» y en
  -- un `if not` se comporta como «adelante».
  select coalesce(public.org_role_of(_org) in ('owner', 'admin'), false);
$$;
