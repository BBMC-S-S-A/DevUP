-- =============================================================================
-- DevUP · 0058 · La cara que uno elige
--
-- QUÉ SE PIDIÓ: «sería bueno que se pueda subir una foto para perfil o poner el
-- personaje de DevVerse». Las dos cosas ya existen por separado —la foto desde
-- la 0057, el personaje en `world_avatars` desde la 0010— y no había forma de
-- decir cuál de las dos es tu cara.
--
-- POR QUÉ UN BOOLEANO Y NO UNA LISTA DE FUENTES. Porque la pregunta real solo
-- tiene dos respuestas. Sin marcar, la cara se resuelve sola por orden —foto
-- subida, foto de Google, inicial— y eso ya funciona y no hay que elegir nada.
-- Marcado, manda el personaje. Una enumeración con «automático», «foto» y
-- «personaje» tendría tres valores para dos decisiones, y el día que alguien
-- ponga «foto» sin tener ninguna habría que inventar qué significa.
--
-- POR QUÉ EL PERSONAJE NO SE GUARDA COMO IMAGEN. Porque no hace falta: son
-- dieciséis números enteros y el navegador ya sabe dibujarlos —es el mismo
-- atlas con el que se pinta el mundo—. Generar un PNG en el servidor añadiría
-- un objeto en el almacén que hay que regenerar cada vez que alguien se cambia
-- el gorro, y el día que se olvide regenerarlo la cara se queda vieja sin que
-- nada falle. Dibujarlo siempre no puede quedarse viejo.
--
-- RLS. No hay tabla nueva, y no hace falta abrir nada: `world_avatars` ya deja
-- leer el personaje a quien comparte organización (0010), exactamente la misma
-- regla que `profiles`. Quien puede ver tu nombre puede ver tu cara, se llame
-- como se llame.
-- =============================================================================

alter table public.profiles
  add column if not exists usa_personaje boolean not null default false;

comment on column public.profiles.usa_personaje is
  'Si esta persona quiere que su cara sea su personaje de DevVerse en vez de '
  'una foto. Falso = se resuelve por orden: foto subida, foto de Google, '
  'inicial. El personaje vive en world_avatars y NO se copia aqui: se dibuja.';

/**
 * Elegir qué cara quieres.
 *
 * Misma forma que el resto de las de la persona —`set_my_title` (0048),
 * `set_my_rol` (0052), `set_my_timezone` (0056), `set_my_avatar_key` (0057)—:
 * una columna, una fila, la de quien llama, y sin `_user`. Elegirle la cara a
 * otro no es una operación que deba existir.
 *
 * NO COMPRUEBA QUE HAYA PERSONAJE, a propósito. Todo el mundo tiene uno: la
 * fila de `world_avatars` se crea con valores por defecto, así que «no tengo
 * personaje» no es un estado posible — es un personaje que nadie ha tocado
 * todavía, y dibujarlo es correcto.
 */
create or replace function public.set_my_usa_personaje(_usar boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set usa_personaje = coalesce(_usar, false)
   where id = public.current_user_id();

  if not found then
    raise exception 'no hay sesión' using errcode = '42501';
  end if;
end;
$$;
