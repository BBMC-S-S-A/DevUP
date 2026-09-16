-- ---------------------------------------------------------------------------
-- 0070 · Avisar a quien invitó de que su enlace caducó
-- ---------------------------------------------------------------------------
--
-- EL PROBLEMA ERA UNA FRASE SIN ACCIÓN. La pantalla de una invitación caducada
-- decía «pídele a fulano que te mande otra» y ahí se acababa: quien llega no
-- tiene sesión, no está en la organización y no tiene forma de decírselo a
-- nadie desde dentro. La única salida era escribirle por fuera —si es que se
-- sabe cómo— o abandonar, que es lo que pasa de verdad.
--
-- LA DECISIÓN, QUE LA TARJETA PEDÍA ANOTAR. Había dos caminos:
--
--   1. Abrir el reenvío SIN sesión. Descartado: sería una ruta que manda correo
--      a una dirección que elige quien llama, y eso es un enviador de spam con
--      nuestro dominio por mucho límite que se le ponga. Además contestaría
--      distinto según si la dirección existe, que es cómo se averigua quién
--      tiene cuenta.
--   2. AVISAR A QUIEN YA ESTÁ DENTRO. Es lo que hace esto. Quien llega solo
--      puede tocar la invitación QUE YA TIENE EN LA MANO, y el aviso va a una
--      sola persona: la que la mandó. No hay ninguna dirección que elegir, así
--      que no hay nada que abusar.
--
-- EL TOKEN CADUCADO SIGUE SIRVIENDO PARA ESTO, y no es una contradicción:
-- caducado significa «ya no abre la puerta», no «ya no identifica de qué
-- invitación hablamos». Lo que se hace con él es lo más inofensivo que se puede
-- hacer con un secreto: decirle a su dueño que hay alguien esperando.
--
-- Y UNA MARCA PARA NO REPETIR. Sin ella, quien tenga el enlace puede pulsar
-- veinte veces y llenarle las notificaciones a quien invitó. Con una hora entre
-- avisos, insistir no molesta a nadie.
-- ---------------------------------------------------------------------------

alter table public.invitations
  add column if not exists reminded_at timestamptz;

create or replace function public.avisar_invitacion_caducada(_token_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  _inv record;
begin
  -- Por token o por código corto: se llega por los dos sitios, y los dos
  -- guardan solo su hash.
  select i.id, i.invited_by, i.email, i.reminded_at, o.name as organizacion
    into _inv
    from public.invitations i
    join public.organizations o on o.id = i.organization_id
   where (i.token_hash = _token_hash or i.code_hash = _token_hash)
     and i.accepted_at is null
   limit 1;

  -- Falso para todo lo que no sea «avisado»: no existe, ya se aceptó, o quien
  -- invitó ya no tiene cuenta. La ruta contesta lo mismo en los tres casos,
  -- porque distinguirlos convertiría esto en un detector de invitaciones.
  if not found or _inv.invited_by is null then
    return false;
  end if;

  if _inv.reminded_at is not null and _inv.reminded_at > now() - interval '1 hour' then
    return false;
  end if;

  perform public.notify(
    _inv.invited_by,
    'invitation',
    'Una invitación tuya caducó',
    _inv.email || ' intentó entrar en ' || _inv.organizacion || ' y el enlace ya no valía.',
    '/app'
  );

  update public.invitations set reminded_at = now() where id = _inv.id;
  return true;
end;
$$;
