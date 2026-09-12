-- =============================================================================
-- DevUP · 0041 · `is_org_admin` no puede devolver nulo
--
-- ESTO ES UN ARREGLO DE SEGURIDAD, NO UNA LIMPIEZA. Lo que sigue es el agujero
-- entero, porque merece contarse bien: cualquiera con una sesión abierta —una
-- cuenta recién registrada, sin pertenecer a nada— podía crear una invitación
-- de ADMINISTRADOR a una organización ajena de la que solo conociera el id,
-- elegir él mismo el token, y canjearla. Es decir, hacerse administrador de la
-- organización de otro. Comprobado contra la base, no deducido leyendo.
--
-- Y LA CAUSA SON TRES LETRAS. `is_org_admin` estaba escrita así:
--
--     select public.org_role_of(_org) in ('owner', 'admin');
--
-- `org_role_of` devuelve el rol de quien llama en esa organización, y para
-- quien no es miembro no devuelve 'ninguno': devuelve NULL. Y `NULL in (...)`
-- en SQL no es falso, es NULL —la lógica de tres valores: «no lo sé»—. Así que
-- para un extraño, `is_org_admin` no contestaba «no», contestaba «no lo sé».
--
-- POR QUÉ ESO NO SE HABÍA NOTADO, que es la parte interesante. En una política
-- de RLS —`using (public.is_org_admin(...))`— un NULL no deja pasar: Postgres
-- solo admite la fila si la expresión es verdadera de verdad. Ahí la función
-- llevaba años comportándose bien. El problema aparece en el otro sitio donde
-- se usa, dentro de PL/pgSQL:
--
--     if not public.is_org_admin(_org) then raise exception ...
--
-- `not NULL` es NULL, y un `if` con condición NULL **no entra en el bloque**.
-- Así que la comprobación de permisos no fallaba: se saltaba. Exactamente el
-- mismo patrón que el repositorio ya conocía de RLS —afecta cero filas y sigue
-- adelante— pero al revés y sin nada que lo parara después.
--
-- La usan así `create_invitation` (0006, 0027), `create_workspace` (0001) y
-- `set_invitation_code` (0040). Se arregla en la función y no en los cuatro
-- sitios: un `coalesce` repetido cuatro veces es un `coalesce` que el quinto
-- sitio olvidará.
--
-- LO QUE NO CAMBIA. En las políticas de RLS, `false` y NULL se comportaban
-- igual —las dos niegan—, así que ningún permiso se abre ni se cierra por este
-- cambio en ninguna política existente. Lo único que cambia es que ahora las
-- comprobaciones explícitas de PL/pgSQL funcionan.
--
-- LA REGLA QUE SE LLEVA DE AQUÍ, para las funciones que vengan: una función de
-- permisos devuelve `boolean not null`, siempre, y se escribe con `exists` o
-- envuelta en `coalesce`. `is_org_member`, `can_access_workspace`,
-- `can_access_channel` y `can_manage_workspace` ya usan `exists` y por eso
-- nunca tuvieron este problema. Esta era la única que no.
-- =============================================================================

create or replace function public.is_org_admin(_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.org_role_of(_org) in ('owner', 'admin'), false);
$$;
