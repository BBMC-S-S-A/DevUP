-- =============================================================================
-- DevUP · 0040 · Código corto de invitación
--
-- LO QUE FALTABA NO ERA INVITAR, ERA PODER DICTARLO. Las invitaciones ya
-- existen desde la 0006 con su token y su canje: se crea una, sale un correo
-- con una URL, y quien la recibe entra. Funciona, y va a seguir funcionando
-- igual. El problema es el caso de al lado, que es el más común en una empresa
-- pequeña: alguien está delante de otra persona, o al teléfono con ella, y le
-- quiere dar acceso AHORA. Hoy eso significa dictar una URL de cien caracteres
-- con un token de 43 en base64url distinguiendo mayúsculas, guiones bajos y
-- guiones normales. No se puede. En la práctica se acaba mandando por
-- WhatsApp, que es exactamente el canal por el que no queríamos que viajaran
-- las credenciales.
--
-- ASÍ QUE ESTO NO SUSTITUYE AL TOKEN: LE HACE COMPAÑÍA. La misma invitación
-- tiene las dos puertas. La URL sigue siendo la del correo —es la que se puede
-- pinchar, y el correo es el canal que verifica que la dirección existe—; el
-- código es la que se dicta. Ninguna de las dos da más acceso que la otra:
-- llevan a la misma fila, con el mismo destino, el mismo rol y la misma
-- caducidad.
--
-- EL CÓDIGO SE GUARDA CIFRADO IGUAL QUE EL TOKEN, Y ESO TIENE UNA CONSECUENCIA
-- INCÓMODA QUE SE ASUME A PROPÓSITO. La 0006 guarda `token_hash` y no el
-- token, para que quien lea la tabla de invitaciones —un respaldo, una consulta
-- de soporte, una fuga— no pueda usar ninguna. Si el código corto se guardara
-- en claro «para poder enseñarlo en la lista», esa propiedad se caería: cada
-- fila de la tabla volvería a ser una llave utilizable. Así que se guarda su
-- hash, y el código en claro existe solo en la respuesta de la petición que lo
-- genera. Quien lo pierde no lo recupera: pide otro
-- (`set_invitation_code`), que invalida el anterior. Es un gesto más, y es el
-- precio correcto.
--
-- POR QUÉ OCHO CARACTERES Y NO CUATRO. Un código corto es una credencial que se
-- puede probar a ciegas, y la defensa no puede ser solo el límite de peticiones
-- —ese protege de un ataque rápido, no de uno paciente—. Con el alfabeto de
-- abajo, ocho caracteres son 32^8 ≈ 1,1 billones de combinaciones: probar la
-- milésima parte a diez intentos por segundo lleva más de tres mil años, y las
-- invitaciones caducan en siete días. Con cuatro serían un millón, que a ese
-- ritmo se agota en un día. La diferencia entre dictar cuatro y dictar ocho es
-- de tres segundos.
--
-- EL ALFABETO ES EL DE CROCKFORD (base32), y no es un capricho de formato: está
-- diseñado justo para esto, para cosas que las personas leen en voz alta y
-- teclean. Quita la I, la L, la O y la U —las cuatro que se confunden al oído o
-- a la vista con el 1, el 0 y entre sí—, y define además cómo perdonar el error
-- al leer: quien teclee «O» quería el cero y quien teclee «I» o «L» quería el
-- uno. Esa normalización vive en la API (`normalizarCodigo`), no aquí, porque
-- la base solo debe ver el hash de la forma ya canónica.
--
-- LA UNICIDAD ES SOLO ENTRE LAS ABIERTAS, igual que el índice de la 0027. Una
-- invitación ya aceptada o ya caducada no compite por el espacio de códigos:
-- mantener sus códigos reservados para siempre iría estrechando el espacio sin
-- ninguna ganancia, porque de todos modos no valen para entrar.
-- =============================================================================

alter table public.invitations
  add column if not exists code_hash text;

-- Dos invitaciones abiertas con el mismo código harían que canjear fuera una
-- lotería. El índice parcial lo hace imposible, y es también lo que permite a
-- la API generar por reintento —pide uno, si choca pide otro— en vez de
-- comprobar antes, que es una carrera perdida de antemano.
create unique index if not exists invitations_one_open_per_code
  on public.invitations (code_hash)
  where code_hash is not null and accepted_at is null;

-- ---------------------------------------------------------------------------
-- Poner (o renovar) el código de una invitación
--
-- SEPARADA DE `create_invitation` A PROPÓSITO. Sirve para las dos cosas que
-- hacen falta: ponerle código a una invitación recién creada, y darle uno
-- nuevo a una que ya existe porque quien lo tenía apuntado lo perdió. Si fuera
-- un parámetro más de la creación, lo segundo obligaría a borrar la invitación
-- y crearla otra vez —lo que invalidaría también su URL, que puede estar ya en
-- el correo de alguien—.
--
-- Renovar invalida el anterior por construcción: hay una sola columna.
-- ---------------------------------------------------------------------------
create or replace function public.set_invitation_code(
  _invitation uuid,
  _code_hash  text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _org uuid;
  _aceptada timestamptz;
begin
  select organization_id, accepted_at into _org, _aceptada
  from public.invitations where id = _invitation;

  if _org is null then
    raise exception 'esa invitación no existe' using errcode = 'P0002';
  end if;

  -- La función es `security definer`, así que RLS no va a parar a nadie aquí
  -- dentro: la comprobación tiene que ser explícita. Sin ella, cualquiera con
  -- sesión podría ponerle código —y por tanto abrir— una invitación ajena de
  -- la que solo conociera el id.
  if not public.is_org_admin(_org) then
    raise exception 'sin permiso sobre esta invitación' using errcode = '42501';
  end if;

  -- Una invitación ya canjeada no vuelve a abrirse. Dar código a una aceptada
  -- sería fabricar una llave para una puerta que ya se usó.
  --
  -- El código de error NO es 23505 a propósito, aunque «ya existe» suene a
  -- unicidad: quien llama reintenta con otro código cuando ve un 23505, porque
  -- eso significa que el código elegido chocó con otro. Confundir las dos cosas
  -- haría que reintentara tres veces algo que no va a cambiar nunca.
  if _aceptada is not null then
    raise exception 'esa invitación ya fue aceptada' using errcode = '22023';
  end if;

  update public.invitations set code_hash = _code_hash where id = _invitation;
end;
$$;

-- ---------------------------------------------------------------------------
-- Mirar una invitación por su código, sin sesión
--
-- Devuelve exactamente lo mismo que `invitation_by_token` y por el mismo
-- motivo: la pantalla que enseña «te han invitado a Acme» es la misma se haya
-- llegado por enlace o tecleando el código, y dos funciones que devuelven
-- formas distintas acabarían con dos pantallas que se parecen.
--
-- No filtra por caducada ni por aceptada: las devuelve marcadas. Contestar
-- «no existe» a una invitación caducada manda a la persona a buscar un error
-- de tecleo que no cometió.
-- ---------------------------------------------------------------------------
create or replace function public.invitation_by_code(_code_hash text)
returns table (
  id                uuid,
  organization_id   uuid,
  organization_name text,
  workspace_id      uuid,
  workspace_name    text,
  email             citext,
  role              public.org_role,
  invited_by_name   text,
  expired           boolean,
  accepted          boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.organization_id, o.name, i.workspace_id, w.name,
         i.email, i.role,
         coalesce(p.display_name, 'alguien'),
         i.expires_at <= now(),
         i.accepted_at is not null
    from public.invitations i
    join public.organizations o on o.id = i.organization_id
    left join public.workspaces w on w.id = i.workspace_id
    left join public.profiles p on p.id = i.invited_by
   where i.code_hash = _code_hash and i.accepted_at is null;
$$;

-- ---------------------------------------------------------------------------
-- Canjear
--
-- EL CUERPO DEL CANJE SE ESCRIBE UNA SOLA VEZ, y las dos puertas —token y
-- código— pasan por él. Copiarlo sería el error clásico de esta clase de
-- cambios: son doce líneas que deciden en qué organización entra alguien y con
-- qué rol, y el día que una de las dos copias se arregle sin la otra habrá una
-- puerta repartiendo permisos distintos de la de al lado sin que nada falle.
--
-- POR QUÉ RECIBE EL HASH Y NO EL ID DE LA INVITACIÓN, que era lo cómodo. Esta
-- función es `security definer`: mete a alguien en una organización saltándose
-- RLS. Si aceptara un id, cualquiera con sesión que llegara a conocer uno
-- —aparece en la lista de invitaciones, en un registro, en una URL de
-- soporte— podría llamarla y meterse solo. Pidiendo el hash, quien la llama
-- tiene que demostrar que conoce el secreto, que es justo lo que la invitación
-- comprueba. Exactamente uno de los dos, para que un `null` despistado no
-- acabe casando con la primera fila que tenga esa columna vacía.
-- ---------------------------------------------------------------------------
create or replace function public.claim_invitation(
  _token_hash text,
  _code_hash  text,
  _user       uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _i record;
begin
  if (_token_hash is null) = (_code_hash is null) then
    raise exception 'hay que canjear por token o por código, no por los dos'
      using errcode = '22023';
  end if;

  select * into _i
  from public.invitations
  where accepted_at is null
    and expires_at > now()
    and (
      (_token_hash is not null and token_hash = _token_hash)
      or (_code_hash is not null and code_hash = _code_hash)
    )
  for update;

  -- El mismo mensaje dé igual si no existe, si ya se usó o si caducó:
  -- distinguirlos le diría a quien prueba códigos a ciegas cuáles ha acertado.
  if _i is null then
    raise exception 'la invitación no es válida o ha caducado' using errcode = 'P0002';
  end if;

  insert into public.organization_members (organization_id, user_id, role, all_workspaces)
  values (_i.organization_id, _user, _i.role, _i.workspace_id is null)
  on conflict (organization_id, user_id) do nothing;

  if _i.workspace_id is not null then
    insert into public.workspace_members (workspace_id, user_id)
    values (_i.workspace_id, _user)
    on conflict (workspace_id, user_id) do nothing;
  end if;

  update public.invitations
  set accepted_at = now(), accepted_by = _user
  where id = _i.id;

  return _i.organization_id;
end;
$$;

create or replace function public.accept_invitation(_token_hash text, _user uuid)
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.claim_invitation(_token_hash, null, _user);
$$;

create or replace function public.accept_invitation_by_code(_code_hash text, _user uuid)
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.claim_invitation(null, _code_hash, _user);
$$;
