-- =============================================================================
-- DevUP · 0048 · A qué se dedica cada quien AQUÍ
--
-- QUÉ FALTABA. La 0022 puso `profiles.title` —«backend», «diseño», «la persona
-- que sabe de facturas»— y acertó en que fuera texto libre: un desplegable
-- cerrado obliga a elegir la casilla que menos te miente. Lo que no previó es
-- que una persona está en varias organizaciones **y no hace lo mismo en todas**.
--
-- Quien tiene tres —la suya, la del cliente, la del estudio— es diseñador en
-- una, socio en otra y «el que arregla el servidor» en la tercera. Con un solo
-- título tiene que elegir cuál de las tres verdades enseña en todas partes, y
-- las otras dos organizaciones ven a alguien mal etiquetado.
--
-- ─────────────────────────────────────────────────────────────────────────────
--
-- NO SUSTITUYE A `profiles.title`, LO AFINA. El de `profiles` sigue siendo el
-- de la persona —lo que pondría en su tarjeta si le preguntaras a secas— y es
-- lo que se enseña cuando no hay nada más específico. El de aquí gana cuando
-- existe. Quitarlo habría obligado a que todo el mundo rellenara su rol en cada
-- organización antes de que nada volviera a enseñar un título.
--
-- Y ES DISTINTO DE `role`, QUE YA ESTÁ EN ESTA MISMA TABLA. `role` es el
-- permiso: owner, admin, member. Decide qué puedes tocar. Esto es el oficio:
-- qué haces. Se confunden todo el rato porque en inglés son la misma palabra,
-- pero un `member` puede ser quien dirige el producto y un `admin` puede ser el
-- becario que administra el tablero. Enseñar «member» donde se preguntaba «¿a
-- qué se dedica?» es la respuesta equivocada a la pregunta correcta.
--
-- SIN POLÍTICA NUEVA. `organization_members` ya tiene las suyas desde 0001 —la
-- lee quien pertenece a la organización— y una columna nueva queda cubierta.
-- Lo que sí hace falta es que el caso de aislamiento siga en verde: si mañana
-- alguien relaja esa política, esto se filtra con ella.
--
-- ESCRIBIRLO ES OTRA COSA, Y NO SE RESUELVE AQUÍ. La política de escritura de
-- `organization_members` es de administradores, porque cambiar el `role` de
-- alguien es dar permisos. Pero el oficio de uno mismo no debería necesitar
-- permiso de nadie, así que va por función aparte (`set_my_title`) en vez de
-- abrir la tabla entera a que cada cual escriba su fila — eso dejaría cambiar
-- también el `role`, que es justo lo que la política protege.
-- =============================================================================

alter table public.organization_members
  add column if not exists title text
    check (title is null or length(btrim(title)) <= 40);

comment on column public.organization_members.title is
  'A qué se dedica esta persona EN esta organización: «backend», «diseño», '
  '«quien lleva las facturas». Texto libre a propósito (ver 0022). No confundir '
  'con `role`, que es el permiso (owner/admin/member) y no el oficio. Cuando '
  'está vacío se enseña `profiles.title`, que es el de la persona en general.';

/**
 * Ponerse el oficio de uno mismo, sin pedirle permiso a nadie.
 *
 * ES `SECURITY DEFINER` PARA PODER SER MÁS ESTRECHA, NO MÁS ANCHA — que es al
 * revés de lo que suele significar. La política de escritura de la tabla exige
 * ser administrador, y con razón: en esa fila vive `role`, y dejar que cada
 * cual escriba la suya sería dejar que se ascienda. Esta función toca **una
 * sola columna, de una sola fila, la de quien llama**. No hay forma de usarla
 * para nada más.
 *
 * Y NO ADMITE UN `_user`: el usuario es siempre `current_user_id()`. Aceptarlo
 * como parámetro habría convertido «ponerme mi oficio» en «ponerle a cualquiera
 * el suyo», que es una función distinta y que además nadie ha pedido.
 */
create or replace function public.set_my_title(_org uuid, _title text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _limpio text := nullif(btrim(coalesce(_title, '')), '');
begin
  if _limpio is not null and length(_limpio) > 40 then
    raise exception 'el oficio no puede pasar de 40 caracteres' using errcode = '22001';
  end if;

  update public.organization_members
     set title = _limpio
   where organization_id = _org
     and user_id = public.current_user_id();

  -- Sin fila no hay nada que escribir, y eso solo pasa si quien llama no
  -- pertenece a esa organización. Se dice, porque callarlo dejaría a alguien
  -- creyendo que guardó su oficio en un sitio donde ni siquiera está.
  if not found then
    raise exception 'no perteneces a esa organización' using errcode = '42501';
  end if;
end;
$$;
