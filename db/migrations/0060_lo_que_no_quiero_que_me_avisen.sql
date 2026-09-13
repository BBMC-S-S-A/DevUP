-- =============================================================================
-- DevUP · 0060 · Lo que no quiero que me avisen
--
-- QUÉ FALTABA. Hay cinco clases de aviso —una mención, una tarea que te
-- asignan, una invitación, una grabación lista y un anuncio— y ninguna forma de
-- decir cuáles quieres. La campana los trae todos, así que quien trabaja con el
-- tablero abierto recibe un aviso por cada tarea que le llega y termina
-- ignorando la campana entera. Una bandeja que se ignora no avisa de nada: la
-- que se pierde es la que importaba.
--
-- SE FILTRA AL ESCRIBIR, NO AL LEER. La fila ni siquiera se crea. Guardarla y
-- esconderla dejaría el contador de no leídos contando cosas que nadie va a
-- ver, y «tienes 14» sobre una bandeja que parece vacía es peor que no tener
-- contador. Un aviso que no se quería no es historia que preservar.
--
-- Y SE FILTRA DENTRO DE `notify()`, que es la única puerta a la tabla. Puesto
-- en cada sitio que avisa —las menciones, el tablero, las grabaciones— habría
-- tres copias de la misma comprobación, y la cuarta que alguien escriba se
-- olvidará de mirar. Aquí no se puede olvidar.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LAS INVITACIONES NO SE PUEDEN SILENCIAR, Y ES A PROPÓSITO
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Las otras cuatro avisan de algo que ya puedes ver por tu cuenta: la mención
-- está en el canal, la tarea en tu tablero, la grabación en su llamada, el
-- anuncio en el tablón. La invitación no: si no te avisan, no hay ninguna
-- pantalla donde descubrirla — todavía no eres de esa organización. Silenciarla
-- no es «menos ruido», es quedarte fuera sin enterarte.
--
-- Por eso la lista de lo que se puede silenciar es CERRADA aquí abajo y no la
-- decide quien llama. Un `text[]` libre dejaría que un cliente mandara
-- 'invitation' y se cerrara esa puerta a sí mismo sin que nada lo impidiera.
--
-- NULO Y VACÍO SON LO MISMO —no silencia nada— y por eso la columna no admite
-- nulos: dos formas de escribir «todo» es una de más, y la primera consulta que
-- olvide el `coalesce` se comporta distinto sin que nada falle.
-- =============================================================================

alter table public.profiles
  add column if not exists avisos_silenciados text[] not null default '{}';

comment on column public.profiles.avisos_silenciados is
  'Clases de aviso que esta persona no quiere recibir. La fila ni se crea: '
  'notify() lo comprueba y devuelve nulo. «invitation» no se admite aqui — sin '
  'ese aviso no hay ninguna pantalla donde descubrir que te invitaron.';

/**
 * Elegir de qué no quieres que te avisen.
 *
 * Misma forma que las demás de la persona (0048, 0052, 0056, 0057, 0058, 0059):
 * una columna, una fila, la de quien llama, y sin `_user`. Silenciarle los
 * avisos a otro es exactamente lo que no debe poder hacerse.
 *
 * Valida contra la lista cerrada y RECHAZA lo que no conozca en vez de
 * ignorarlo: si alguien manda 'menciones' en vez de 'mention', callarse
 * dejaría a esa persona creyendo que silenció algo que le sigue llegando.
 */
create or replace function public.set_my_avisos_silenciados(_clases text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _limpias text[] := coalesce(_clases, '{}');
  _clase   text;
begin
  foreach _clase in array _limpias loop
    if _clase not in ('mention', 'task_assigned', 'recording', 'announcement') then
      raise exception 'no se puede silenciar «%»', _clase using errcode = '22023';
    end if;
  end loop;

  update public.profiles
     set avisos_silenciados = _limpias
   where id = public.current_user_id();

  if not found then
    raise exception 'no hay sesión' using errcode = '42501';
  end if;
end;
$$;

/**
 * `notify()` mira antes de escribir.
 *
 * Se reescribe entera porque el cambio va EN MEDIO —después de comprobar que
 * se comparte organización y antes de insertar— y un `create or replace` con
 * medio cuerpo no existe. Lo de arriba y lo de abajo es idéntico a la 0006.
 *
 * Devuelve NULO cuando el aviso está silenciado, y quien llama ya lo trata:
 * `notificar()` en la API hace `if (!id) return` desde siempre, porque la
 * función ya podía no devolver nada. O sea que silenciar no necesita tocar ni
 * una línea de lo que avisa.
 */
create or replace function public.notify(
  _user  uuid,
  _kind  text,
  _title text,
  _body  text,
  _link  text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _actor uuid := public.current_user_id();
  _id    uuid;
begin
  if _actor is null then
    raise exception 'sin sesión' using errcode = '42501';
  end if;

  if _user <> _actor and not exists (
    select 1
    from public.organization_members mine
    join public.organization_members theirs
      on theirs.organization_id = mine.organization_id
    where mine.user_id = _actor and theirs.user_id = _user
  ) then
    raise exception 'no compartís ninguna organización' using errcode = '42501';
  end if;

  -- Silenciado: ni se escribe. Ver la cabecera — guardarla y esconderla dejaría
  -- el contador de no leídos contando lo que nadie va a ver.
  if exists (
    select 1 from public.profiles p
     where p.id = _user and _kind = any(p.avisos_silenciados)
  ) then
    return null;
  end if;

  insert into public.notifications (user_id, kind, title, body, link, actor_id)
  values (_user, _kind, _title, coalesce(_body, ''), coalesce(_link, ''), _actor)
  returning id into _id;

  return _id;
end;
$$;
