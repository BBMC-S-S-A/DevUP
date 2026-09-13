-- =============================================================================
-- DevUP · 0059 · El recorrido se ve una vez
--
-- QUÉ CIERRA ESTO. La 0052 añadió `organization_members.rol` con un solo
-- propósito escrito en su propio comentario: «elegir qué tutorial se ofrece».
-- Desde entonces el rol se guarda y no hace nada — un dato que solo se escribe
-- es una promesa a medias, y el producto lleva tres tandas haciéndola.
--
-- POR QUÉ EN LA CUENTA Y NO EN EL NAVEGADOR. Es lo contrario del micrófono.
-- «Ya me explicaron esto» es de la PERSONA: quien lo vio en el portátil no
-- necesita que se lo cuenten otra vez al abrirlo en el móvil, y que se lo
-- cuenten es peor que no tener recorrido — enseña que el producto no se acuerda
-- de ti.
--
-- POR QUÉ UNA FECHA Y NO UN BOOLEANO. Un `true` contesta «¿lo vio?»; una fecha
-- contesta además «¿cuándo?», que es la pregunta que se hace al cambiar el
-- recorrido: quien lo vio hace seis meses vio otro producto. Con un booleano,
-- volver a ofrecerlo obliga a borrar la marca de todo el mundo y nadie se
-- atreve. Cuesta lo mismo.
--
-- POR ORGANIZACIÓN NO, Y ESO ES UNA DECISIÓN. El rol SÍ es por organización —la
-- misma persona es «backend» en un proyecto y «plataforma» en otro— pero el
-- recorrido explica qué es un espacio, qué es una rama y cómo se cierra una
-- tarea, y eso no cambia de una organización a otra. Repetirlo al entrar en la
-- segunda sería castigar a quien colabora con dos equipos.
-- =============================================================================

alter table public.profiles
  add column if not exists recorrido_visto timestamptz;

comment on column public.profiles.recorrido_visto is
  'Cuando esta persona termino o salto el recorrido de bienvenida. Nula = no lo '
  'ha visto. Fecha y no booleano para poder volver a ofrecerlo cuando el '
  'recorrido cambie, sin tener que borrar la marca de todo el mundo.';

/**
 * Dar el recorrido por visto, o volver a pedirlo.
 *
 * La misma forma que las demás de la persona (0048, 0052, 0056, 0057, 0058):
 * una columna, una fila, la de quien llama, y sin `_user`.
 *
 * SALTARLO CUENTA COMO VERLO, a propósito. Quien lo cierra ha tomado una
 * decisión —«esto no me hace falta»— y volver a ponérselo delante mañana es no
 * haberla respetado. Se puede pedir otra vez desde ajustes, que es donde se
 * busca algo que se cerró queriendo.
 */
create or replace function public.set_my_recorrido(_visto boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set recorrido_visto = case when coalesce(_visto, true) then now() else null end
   where id = public.current_user_id();

  if not found then
    raise exception 'no hay sesión' using errcode = '42501';
  end if;
end;
$$;
