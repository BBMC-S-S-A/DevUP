-- ---------------------------------------------------------------------------
-- 0067 · Refrescar la sesión desde dos pestañas no puede echarte de las dos
-- ---------------------------------------------------------------------------
--
-- EL FALLO. El token de refresco es de un solo uso: `session_consume` lo canjea
-- y lo revoca en la misma sentencia, así que uno robado sirve una vez y deja de
-- valer en cuanto el dueño refresca. Eso está bien y se queda.
--
-- Lo que no está bien es lo que pasa cuando las dos peticiones son del MISMO
-- dueño. Dos pestañas de DevUP abiertas, quince minutos sin tocar nada, se
-- vuelve a una: las dos piden a la vez, las dos reciben 401, las dos refrescan
-- con la MISMA cookie. Una gana y deja cookies nuevas. La otra no encuentra
-- nada que canjear, y la ruta de refrescar responde a eso BORRANDO las cookies
-- de sesión — que son las mismas del navegador, las que la pestaña ganadora
-- acaba de dejar. Resultado: las dos pestañas fuera, con un token de refresco
-- de treinta días perfectamente vivo.
--
-- El cliente no puede arreglarlo solo: cada pestaña tiene su propio JavaScript,
-- así que no hay forma de que compartan un refresco en curso.
--
-- EL ARREGLO: una ventana de gracia de diez segundos. Si el token presentado ya
-- se rotó hace muy poco, en vez de fallar se le abre una sesión nueva a su
-- dueño. La pestaña perdedora sigue dentro, con su propia sesión.
--
-- POR QUÉ UNA COLUMNA NUEVA Y NO MIRAR `revoked_at`. Porque hay dos motivos
-- muy distintos para revocar una sesión, y confundirlos sería grave: rotarla al
-- refrescar, y CERRAR SESIÓN. `session_revoke` —la de cerrar sesión— solo toca
-- `revoked_at`. Si la gracia mirara esa columna, cerrar sesión y volver atrás
-- en el navegador dentro de los diez segundos resucitaría la sesión que se
-- acababa de cerrar, que es justo lo que alguien intenta evitar cuando cierra
-- sesión en un ordenador prestado. Con `rotated_at` aparte, la gracia solo
-- alcanza a lo que se rotó por refrescar.
--
-- LO QUE ESTO CUESTA. Durante diez segundos después de una rotación, el token
-- viejo vale para abrir otra sesión. Un token robado ya valía para eso mientras
-- estuviera vivo; lo que se añade es una cola de diez segundos. A cambio se
-- quita un deslogueo que a la gente le pasa de verdad y todos los días.
--
-- REVERSIBLE. Volver atrás es restaurar la versión de `session_consume` de
-- 0029 y, si se quiere, `alter table public.sessions drop column rotated_at`.
-- Ninguna fila se pierde: la columna solo añade información.

-- `set local` y no `set`: el corredor de migraciones envuelve cada archivo en
-- una transacción y reutiliza la misma conexión para los siguientes, así que un
-- `set` pelado se le quedaría puesto a las migraciones de después.
--
-- Cinco segundos porque `add column` nullable y sin valor por defecto es un
-- cambio de catálogo —instantáneo, sin reescribir la tabla, da igual cuántas
-- filas haya—, pero necesita el bloqueo exclusivo un instante. Si justo
-- entonces hay una consulta larga sobre `sessions`, sin esto la migración se
-- pone a la cola y TODO lo que toque sesiones se queda esperando detrás: la
-- aplicación entera, por una columna que tarda un microsegundo. Mejor que
-- falle y se reintente.
set local lock_timeout = '5s';

alter table public.sessions
  add column if not exists rotated_at timestamptz;

-- Sin índice a propósito: la búsqueda entra siempre por `refresh_token_hash`,
-- que ya es único, y a partir de ahí es una fila. Un índice sobre `rotated_at`
-- no lo usaría nadie y habría que mantenerlo en cada rotación.

-- DOS SENTENCIAS, Y ESO ES EL ARREGLO ENTERO. La primera versión de esto metía
-- las dos ramas en UN solo `select` con CTEs, y se probó contra el servidor que
-- NO sirve: la rama de gracia leía la instantánea del principio de la
-- sentencia, de antes de que la otra pestaña confirmara, así que veía
-- `rotated_at` todavía a nulo y no devolvía nada. Justo en el caso que venía a
-- arreglar —las dos peticiones solapadas— seguía echando a la perdedora.
--
-- En `plpgsql` son sentencias separadas, y con READ COMMITTED (lo que abre
-- `withUser`: un `begin` pelado) CADA SENTENCIA TOMA INSTANTÁNEA NUEVA. El
-- `update` de abajo se queda esperando el bloqueo de fila que tiene la pestaña
-- ganadora; cuando esta confirma, el `update` no encuentra nada que rotar —ya
-- está revocada— y entonces el `select` siguiente, con instantánea fresca, sí
-- ve la marca. Que se quede esperando el bloqueo es lo que hace que funcione,
-- no un efecto secundario.
create or replace function public.session_consume(_token_hash text)
returns table (session_id uuid, user_id uuid, label text, is_agent boolean)
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  -- El canje de siempre: se rota y se revoca en la misma sentencia, así que un
  -- token robado sigue sirviendo una sola vez.
  return query
    update public.sessions s
       set revoked_at = now(),
           rotated_at = now()
     where s.refresh_token_hash = _token_hash
       and s.revoked_at is null
       and s.expires_at > now()
    returning s.id, s.user_id, s.label, s.is_agent;

  if found then
    return;
  end if;

  -- La perdedora de la carrera. No revoca nada porque no queda nada que
  -- revocar: la sesión que este token nombraba ya la cerró la pestaña que ganó.
  -- Lo único que se devuelve es de QUIÉN era, para poder abrirle otra.
  --
  -- `rotated_at` y no `revoked_at`: ver la cabecera. Cerrar sesión no marca
  -- esta columna, así que la gracia no alcanza a una sesión cerrada a mano.
  return query
    select s.id, s.user_id, s.label, s.is_agent
      from public.sessions s
     where s.refresh_token_hash = _token_hash
       and s.rotated_at is not null
       and s.rotated_at > now() - interval '10 seconds'
       and s.expires_at > now();
end;
$$;
