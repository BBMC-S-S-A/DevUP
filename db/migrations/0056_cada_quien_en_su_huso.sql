-- =============================================================================
-- DevUP · 0056 · Cada quien en su huso
--
-- QUÉ FALLA HOY, Y FALLA EN SILENCIO. `GET /workspaces/:id/diario` agrupa por
-- semanas y recibe el huso como parámetro, con `UTC` por defecto. En UTC, lo
-- que alguien cerró un domingo por la tarde en Bogotá cuenta en la semana
-- SIGUIENTE. El hito aparece —no se pierde nada— pero en la casilla
-- equivocada, y la lista se ve perfectamente normal. Ya pasó una vez: «el
-- embudo y el panel pintaban el día anterior en Colombia».
--
-- Hoy lo tapa el navegador, que manda el suyo. Pero eso solo funciona cuando
-- hay un navegador delante:
--
--   · El MCP tiene que acordarse de pasar `huso` en cada llamada. Si se olvida
--     —y olvidarse es el caso normal— contesta en UTC con total seguridad.
--   · Un correo, un aviso o un informe que el servidor mande por su cuenta no
--     tiene a quién preguntárselo.
--
-- Un dato que solo existe mientras alguien mira la pantalla no es un dato del
-- producto. Este sí.
--
-- POR QUÉ NO HAY `CHECK` CON LA LISTA DE HUSOS. Porque la lista de husos
-- CAMBIA —los países mueven sus reglas— y una restricción de tabla exige una
-- expresión inmutable: `pg_timezone_names` no lo es. Una copia nuestra de la
-- lista solo garantiza que algún día discrepe de la de Postgres, que es la que
-- de verdad manda al hacer las cuentas. Se valida al escribir, en la función,
-- contra la lista de verdad.
--
-- NULO ES UNA RESPUESTA VÁLIDA y significa «no lo he dicho». Quien no lo diga
-- sigue viendo UTC, igual que hoy: esto no cambia el comportamiento de nadie
-- por sorpresa, solo deja de ser la única opción.
-- =============================================================================

alter table public.profiles
  add column if not exists timezone text;

comment on column public.profiles.timezone is
  'Nombre IANA del huso de esta persona, como «America/Bogota». Nulo = no lo ha '
  'dicho, y entonces se usa UTC. Se escribe solo por set_my_timezone, que lo '
  'valida contra pg_timezone_names; no hay CHECK porque esa lista cambia y una '
  'restriccion de tabla necesita una expresion inmutable.';

/**
 * Decir en qué huso estás.
 *
 * Misma forma que `set_my_title` (0048) y `set_my_rol` (0052), y por el mismo
 * motivo: toca UNA columna, de UNA fila, la de quien llama, y no admite un
 * `_user`. Decir dónde vivo no puede convertirse en decidírselo a otro.
 *
 * Cadena vacía lo borra, que no es lo mismo que no llamar: es «vuelve a UTC».
 */
create or replace function public.set_my_timezone(_tz text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _limpio text := nullif(btrim(coalesce(_tz, '')), '');
begin
  if _limpio is not null
     and not exists (select 1 from pg_timezone_names where name = _limpio) then
    -- El nombre en el mensaje a propósito: quien se equivoca escribiendo
    -- «America/Bogotá» con tilde necesita ver QUÉ mandó para verlo.
    raise exception 'el huso «%» no existe: se escriben como America/Bogota', _limpio
      using errcode = '22023';
  end if;

  update public.profiles
     set timezone = _limpio
   where id = public.current_user_id();

  if not found then
    raise exception 'no hay sesión' using errcode = '42501';
  end if;
end;
$$;

/**
 * El huso de una persona, o UTC.
 *
 * EXISTE PARA QUE EL «O UTC» ESTÉ ESCRITO UNA SOLA VEZ. Repartido por cada
 * consulta que agrupa por fecha, basta con que alguien escriba una sin el
 * `coalesce` para que esa vista —y solo esa— cuente los domingos en la semana
 * que no es, sin que nada falle.
 *
 * `stable` y no `volatile`: no escribe, y así el planificador puede llamarla
 * una vez por consulta en vez de una por fila.
 */
create or replace function public.huso_de(_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.timezone from public.profiles p where p.id = _user),
    'UTC'
  );
$$;
