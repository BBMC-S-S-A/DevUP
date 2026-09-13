-- =============================================================================
-- DevUP · 0057 · La foto que uno sube
--
-- QUÉ FALTABA. `profiles.avatar_url` existe desde la 0026 y solo la escribe
-- entrar con Google. Quien se registró con correo no tiene forma de ponerse
-- foto, y quien entró con Google no tiene forma de cambiarla. En toda la
-- aplicación el avatar es la inicial.
--
-- POR QUÉ UNA COLUMNA NUEVA Y NO REUTILIZAR `avatar_url`. Porque no guardarían
-- lo mismo. La de Google es una URL pública que se pinta tal cual; la que uno
-- sube es una CLAVE del almacén, que no se puede pintar sin firmarla antes.
-- Meter las dos en la misma columna obliga a adivinar cuál es cada valor
-- mirando si empieza por «https», y el día que el almacén use un prefijo
-- parecido, la adivinanza falla en silencio y el navegador pide una imagen a
-- una dirección que no existe.
--
-- CUÁL GANA: la subida. Si alguien se molestó en poner una foto, esa es la que
-- quiere — la de Google llegó sola. Y por eso borrar la subida NO borra la otra:
-- «quitar mi foto» devuelve a la de Google si la había, y a la inicial si no,
-- que es lo que se espera de deshacer.
--
-- RLS. No hay tabla nueva. `profiles` ya tiene sus políticas desde la 0001: el
-- perfil lo lee quien comparte organización y lo escribe solo su dueño. La
-- clave del almacén se devuelve NUNCA al navegador — lo que viaja es una URL
-- firmada y caduca, igual que con el logo de una organización y con cualquier
-- archivo.
-- =============================================================================

alter table public.profiles
  add column if not exists avatar_key text;

comment on column public.profiles.avatar_key is
  'Clave en el almacen de la foto que esta persona subio. Nula = no ha subido '
  'ninguna, y entonces vale avatar_url (la de Google) y, si tampoco, la '
  'inicial. NO es una URL: no se puede pintar sin firmarla. Se escribe por '
  'set_my_avatar_key, que solo toca la fila de quien llama.';

/**
 * Poner o quitar la foto propia.
 *
 * Misma forma que `set_my_title` (0048), `set_my_rol` (0052) y
 * `set_my_timezone` (0056), y por el mismo motivo: toca UNA columna, de UNA
 * fila, la de quien llama, y no admite un `_user`. Ponerle una foto a otro no
 * es una operación que deba existir.
 *
 * Devuelve la clave ANTERIOR para que quien llama pueda borrar ese objeto del
 * almacén. Sin esto, cada cambio de foto deja la vieja ocupando sitio para
 * siempre — y nadie vuelve a mirar si está.
 */
create or replace function public.set_my_avatar_key(_clave text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  _antes text;
  _limpio text := nullif(btrim(coalesce(_clave, '')), '');
begin
  select avatar_key into _antes from public.profiles where id = public.current_user_id();

  update public.profiles
     set avatar_key = _limpio
   where id = public.current_user_id();

  if not found then
    raise exception 'no hay sesión' using errcode = '42501';
  end if;

  -- Nula si no cambió: devolver la misma clave haría que quien llama borrara
  -- del almacén el objeto que acaba de guardar.
  return case when _antes is distinct from _limpio then _antes else null end;
end;
$$;
