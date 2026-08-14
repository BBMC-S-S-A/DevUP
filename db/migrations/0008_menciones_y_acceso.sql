-- =============================================================================
-- 0008 — Las menciones dejan de filtrar los canales privados
--
-- `resolve_mentions` unía contra `organization_members`: cualquiera de la
-- organización cuyo nombre apareciera tras una «@» recibía la notificación,
-- **también desde un canal privado en el que no estaba**. La notificación lleva
-- el nombre del canal y un fragmento del mensaje, así que mencionar a alguien
-- por error —o a propósito— le revelaba que ese canal existe y parte de lo que
-- se dice dentro. Es justo lo contrario de lo que promete un canal privado.
--
-- El comentario en la ruta de mensajes afirmaba que la función «solo devuelve
-- gente con acceso al canal». Era falso. Aquí se hace verdad.
--
-- El arreglo necesita una comprobación de acceso parametrizada por usuario:
-- `can_access_channel` responde siempre por `current_user_id()`, y aquí hay que
-- preguntar por cada candidato a mencionado, que no es quien escribe.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Acceso a un canal, preguntando por un usuario cualquiera
-- ---------------------------------------------------------------------------
-- Misma lógica exacta que `can_access_channel`, con el usuario como argumento
-- en vez de leerlo de la sesión. Se mantienen las dos: la de un argumento es la
-- que usan las políticas RLS —donde el sujeto siempre es quien consulta— y
-- reescribirlas todas para pasar `current_user_id()` a mano sería más ruido que
-- provecho, y una ocasión más de equivocarse.
create or replace function public.can_user_access_channel(_user uuid, _channel uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.channels c
    join public.workspaces w on w.id = c.workspace_id
    join public.organization_members m
      on m.organization_id = w.organization_id
     and m.user_id = _user
    where c.id = _channel
      and (w.visibility = 'shared' or w.created_by = _user)
      and (
        not c.is_private
        or exists (
          select 1 from public.channel_members cm
          where cm.channel_id = c.id and cm.user_id = _user
        )
      )
  );
$$;

-- `can_access_channel` pasa a ser la de un argumento aplicada a la sesión, para
-- que no puedan divergir: si mañana alguien añade una regla en una y se olvida
-- de la otra, vuelve la fuga por la puerta de al lado.
create or replace function public.can_access_channel(_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_user_access_channel(public.current_user_id(), _channel);
$$;

-- ---------------------------------------------------------------------------
-- Menciones
-- ---------------------------------------------------------------------------
-- El único cambio real: `can_user_access_channel` en lugar de la pertenencia a
-- la organización. Un workspace personal queda cubierto de paso — mencionar a
-- alguien dentro del propio espacio ya no le escribe.
create or replace function public.resolve_mentions(_channel uuid, _body text)
returns table (user_id uuid, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct p.id, p.display_name
    from public.channels c
    join public.workspaces w on w.id = c.workspace_id
    join public.organization_members m on m.organization_id = w.organization_id
    join public.profiles p on p.id = m.user_id
   where c.id = _channel
     and length(btrim(p.display_name)) > 0
     -- Coincidencia por «@» seguido del nombre visible, sin distinguir
     -- mayúsculas ni acentos. Es tosco, pero un analizador de menciones de
     -- verdad necesita que el redactor guarde los identificadores al escribir,
     -- y eso es otra iteración.
     and _body ilike '%@' || p.display_name || '%'
     -- Lo que faltaba.
     and public.can_user_access_channel(p.id, c.id);
$$;

grant execute on function public.can_user_access_channel(uuid, uuid) to devup_app;
