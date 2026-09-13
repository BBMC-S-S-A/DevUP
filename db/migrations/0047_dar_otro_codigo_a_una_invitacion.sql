-- =============================================================================
-- DevUP · 0047 · Dar otro código a una invitación que ya existe
--
-- QUÉ FALTABA, Y POR QUÉ ERA UN BOTÓN APAGADO. La 0041 dejó el código corto
-- entero salvo por una cosa: solo se puede poner AL CREAR la invitación. Dárselo
-- a una que ya existe no tenía función detrás, así que el botón de la pantalla
-- de ajustes llevaba semanas desactivado con una nota explicando por qué.
--
-- La salida de mientras era reinvitar, y sirve, pero no es lo mismo: reinvitar
-- borra la invitación anterior y con ella **su enlace**. Ese enlace puede estar
-- ya abierto en el móvil de la otra persona, que es justo el momento en el que
-- llama para decir «se me perdió el código, dímelo otra vez». Romperle el enlace
-- para arreglarle el código es cambiar un problema pequeño por uno mayor.
--
-- ─────────────────────────────────────────────────────────────────────────────
--
-- EL CÓDIGO ANTERIOR MUERE SIEMPRE, y no es un efecto secundario: es el punto.
-- Dar otro código sin matar el de antes dejaría dos vivos para la misma
-- invitación, y el viejo es justo el que se quiere retirar —se dictó mal, se
-- quedó escrito en la pizarra de una sala, se mandó por un chat que no era—.
-- Como se guarda el hash y no el código, «renovar» es literalmente escribir
-- encima: el anterior deja de existir en el mismo `update`.
--
-- LO QUE **NO** TOCA ES EL TOKEN. Es la diferencia con reinvitar y la razón de
-- que esta función exista. El enlace largo sigue valiendo, con su caducidad, y
-- quien ya lo tenga abierto puede seguir.
--
-- SOBRE UNA INVITACIÓN YA ACEPTADA NO SE HACE NADA, y se dice en voz alta en vez
-- de escribir en silencio. Un código nuevo sobre una aceptada sería un código
-- que `accept_invitation` nunca va a admitir —exige `accepted_at is null`— y que
-- además se saltaría el índice único, que también excluye las aceptadas. O sea:
-- quedaría un código vivo a ojos de quien lo dictó y muerto a ojos de la base.
-- Esa es exactamente la clase de fallo que hace que alguien pierda una tarde.
--
-- SOBRE UNA CADUCADA SÍ, a propósito. Renovar el código de una invitación cuyo
-- código expiró ayer es el caso NORMAL —vive veinticuatro horas— y negarlo
-- obligaría a reinvitar, que es lo que esto viene a evitar.
--
-- EL PERMISO LO PONE ESTA FUNCIÓN Y NADIE MÁS. Es `security definer`, así que
-- RLS no la frena: el `is_org_admin` de abajo es el único guardia que hay. Desde
-- la 0042 esa función contesta `false` a un extraño en vez de `null`, que es lo
-- que hacía que un `if not ...` no entrara en el bloque y dejara pasar a
-- cualquiera. Aquí se nota especialmente: quien pueda poner código a una
-- invitación de administrador, se pone a sí mismo de administrador.
-- =============================================================================

create or replace function public.set_invitation_code(
  _invitation      uuid,
  _code_hash       text,
  _code_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _org      uuid;
  _aceptada boolean;
begin
  -- Se bloquea la fila antes de mirarla: dos administradores pidiendo código a
  -- la vez sobre la misma invitación se quedarían cada uno con el suyo y solo
  -- uno funcionaría, sin que ninguno de los dos supiera cuál.
  select organization_id, accepted_at is not null
    into _org, _aceptada
  from public.invitations
  where id = _invitation
  for update;

  -- La misma respuesta para «no existe» y para «no es tuya»: distinguirlas
  -- dejaría probar identificadores hasta dar con uno que conteste distinto, y
  -- eso revela qué invitaciones hay en organizaciones ajenas.
  if _org is null or not public.is_org_admin(_org) then
    raise exception 'esa invitación no existe o no está a tu alcance'
      using errcode = '42501';
  end if;

  if _aceptada then
    raise exception 'esa invitación ya se aceptó: un código nuevo no serviría de nada'
      using errcode = '23505';
  end if;

  -- Escribir encima ES retirar el anterior. Ver la cabecera.
  update public.invitations
     set code_hash = _code_hash,
         code_expires_at = _code_expires_at
   where id = _invitation;

  return _invitation;
end;
$$;

-- Nota para quien venga a esto desde el índice único de la 0041
-- (`invitations_code_hash_idx`): si dos invitaciones vivas acabaran con el mismo
-- hash, este `update` falla con 23505 y no escribe nada. Es lo correcto — un
-- código ambiguo no se puede canjear— y quien llama solo tiene que sortear otro.
-- Con 31 símbolos y ocho posiciones eso no va a pasar, pero «no va a pasar» no
-- es lo mismo que «no está contemplado».
