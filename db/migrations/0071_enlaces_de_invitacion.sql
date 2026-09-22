-- ---------------------------------------------------------------------------
-- 0071 · Enlaces de invitación reutilizables, a la organización o a un espacio
-- ---------------------------------------------------------------------------
--
-- QUÉ FALTABA. Hoy hay dos formas de entrar y las dos empiezan por el correo de
-- alguien: el token por correo (una invitación por persona) y el código corto
-- dictable por teléfono. Falta el gesto de Discord —un enlace que se pega en un
-- grupo y entra quien quiera— que es el correcto para meter a cinco personas de
-- golpe.
--
-- Y FALTABA CON ALCANCE. Lo que se pidió fue un enlace para UN ESPACIO: «cada
-- proyecto trabaja por separado, quiero pasarle a mi grupo el enlace de este».
-- El mismo mecanismo sirve para los dos alcances, así que es una tabla con una
-- columna, no dos tablas que se copian.
--
-- ────────────────────────────────────────────────────────────────────────────
-- ENTRAR A UN ESPACIO ES ENTRAR TAMBIÉN A SU ORGANIZACIÓN. NO ES OPCIONAL.
-- ────────────────────────────────────────────────────────────────────────────
--
-- `can_access_workspace` (0027) exige ser miembro de la organización ANTES de
-- mirar nada del espacio. O sea que no existe «estar en un espacio sin estar en
-- la organización», y un enlace de espacio tiene que hacer las dos cosas.
--
-- Lo que sí se puede acotar es CUÁNTO se ve de la organización, y por eso el
-- canje pone `all_workspaces = false`: quien entra por un enlace de espacio ve
-- ESE espacio y ninguno más, ni los que se creen después. Es lo más cerca que
-- el modelo llega de «solo este proyecto», y conviene decirlo en vez de que
-- alguien lo descubra al ver aparecer gente en la lista de su organización.
--
-- ────────────────────────────────────────────────────────────────────────────
-- UN ENLACE REUTILIZABLE ES UNA PUERTA ABIERTA
-- ────────────────────────────────────────────────────────────────────────────
--
-- Por eso esto no es «guardar una URL». Cada columna de abajo existe para que
-- la puerta se pueda cerrar:
--
--   · `expires_at` es OBLIGATORIA. Un enlace sin caducidad es un enlace que
--     alguien reenvía dentro de un año a un grupo que ya no es este.
--   · `max_uses` topa cuánta gente entra, y se puede dejar en 1 — que convierte
--     el enlace reutilizable en uno de un solo uso sin cambiar de mecanismo.
--   · `revoked_at` lo cierra a mano, antes de tiempo.
--   · `role` NUNCA es administrador, y lo impide un `check`, no el código de
--     una ruta: si un día una ruta nueva se olvida, la base no.
--
-- SOLO SE GUARDA EL HASH, como en el código corto: quien lea esta tabla no
-- puede entrar con lo que encuentre. Eso significa que un enlace no se puede
-- «volver a ver» — se copia al crearlo, o se hace otro.

create table if not exists public.invite_links (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Null = enlace a la organización entera. Con valor = a ese espacio y solo a
  -- ese. La organización va SIEMPRE, incluso en los de espacio: es a quien
  -- pertenece el enlace, y sin ella no se podría saber a qué organización se
  -- entra hasta resolver el espacio.
  workspace_id    uuid references public.workspaces(id) on delete cascade,
  token_hash      text not null unique,
  role            public.org_role not null default 'member'
                    check (role <> 'owner' and role <> 'admin'),
  expires_at      timestamptz not null,
  max_uses        integer not null default 25 check (max_uses between 1 and 500),
  uses            integer not null default 0 check (uses >= 0),
  revoked_at      timestamptz,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

-- Por dónde se consulta de verdad: la pantalla lista los enlaces de una
-- organización o de un espacio. El `unique` de `token_hash` ya cubre el canje,
-- que entra por el hash.
--
-- SIN `where revoked_at is null`, aunque la pantalla solo liste los vivos. Un
-- índice parcial no le sirve a la clave ajena: al borrar una organización o un
-- espacio, Postgres tiene que encontrar TODAS sus filas para la cascada, y las
-- revocadas quedarían fuera del índice. Es la clase de detalle que no se nota
-- hasta que borrar algo empieza a tardar.
create index if not exists invite_links_org_idx on public.invite_links (organization_id);
create index if not exists invite_links_ws_idx on public.invite_links (workspace_id);

-- `created_by` se queda SIN índice a propósito. Es `on delete set null`, y la
-- única consulta que lo recorrería es borrar una cuenta, que ya repasa media
-- base. Un índice más en una tabla que tendrá decenas de filas cuesta más
-- mantenerlo que lo que ahorra.

-- --- Quién los ve y quién los crea -------------------------------------------

alter table public.invite_links enable row level security;

-- Ver los enlaces de un espacio: quien manda en ese espacio. Y los de la
-- organización: quien la administra. No se listan a cualquiera que pertenezca,
-- porque la lista dice cuántas puertas hay abiertas y hasta cuándo.
drop policy if exists invite_links_select on public.invite_links;
create policy invite_links_select on public.invite_links for select
  using (
    case
      when workspace_id is null then public.is_org_admin(organization_id)
      else public.can_manage_workspace(workspace_id)
    end
  );

-- CREARLOS PIDE MANDO, con la misma regla. Abrir una puerta a un proyecto no es
-- un gesto de cualquiera que trabaje en él.
drop policy if exists invite_links_insert on public.invite_links;
create policy invite_links_insert on public.invite_links for insert
  with check (
    case
      when workspace_id is null then public.is_org_admin(organization_id)
      else public.can_manage_workspace(workspace_id)
    end
  );

-- Revocar es un `update` de `revoked_at`. Mismo mando: quien pudo abrir puede
-- cerrar.
drop policy if exists invite_links_update on public.invite_links;
create policy invite_links_update on public.invite_links for update
  using (
    case
      when workspace_id is null then public.is_org_admin(organization_id)
      else public.can_manage_workspace(workspace_id)
    end
  )
  with check (
    case
      when workspace_id is null then public.is_org_admin(organization_id)
      else public.can_manage_workspace(workspace_id)
    end
  );

-- NO HAY POLÍTICA DE BORRADO, y es a propósito: un enlace que se usó es el
-- rastro de por dónde entró alguien. Se revoca, que lo deja inútil y visible;
-- borrarlo dejaría a gente dentro sin nada que explique cómo llegó.

-- ---------------------------------------------------------------------------
-- Canjear un enlace
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER PORQUE QUIEN LO USA TODAVÍA NO ES DE LA CASA. Ese es el
-- punto entero: la persona tiene cuenta pero no pertenece a la organización, así
-- que ninguna política suya la deja ni mirar el enlace. Alguien tiene que poder
-- comprobarlo y darle la entrada, y es esta función.
--
-- TODO PASA EN UNA SOLA SENTENCIA, y de ahí sale la garantía que importa: el
-- `update` con `uses < max_uses` bloquea la fila, así que dos personas que
-- pulsen el enlace a la vez no pueden pasar del tope. Comprobar primero y
-- escribir después —lo que parece más legible— es justo la carrera que deja
-- entrar a uno de más.
--
-- DEVUELVE POR QUÉ NO, no un booleano. «Caducado», «agotado» y «revocado» son
-- tres cosas distintas para quien está delante de la pantalla, y un `false`
-- obligaría a adivinar cuál. Es la diferencia entre «pide otro enlace» y
-- «habla con quien te lo pasó».
create or replace function public.invite_link_redeem(_token_hash text, _user uuid)
-- LOS NOMBRES DE SALIDA NO SE LLAMAN COMO LAS COLUMNAS, y no es estilo: se
-- probó con `organization_id` y Postgres aborta el canje con «column reference
-- is ambiguous» en el `on conflict` de abajo, porque no sabe si te refieres al
-- parámetro de salida o a la columna. Falla en ejecución, no al crear la
-- función, así que se descubre canjeando.
returns table (motivo text, org uuid, espacio uuid)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  fila public.invite_links%rowtype;
begin
  select * into fila from public.invite_links l where l.token_hash = _token_hash;

  if not found then
    return query select 'no-existe'::text, null::uuid, null::uuid;
    return;
  end if;
  if fila.revoked_at is not null then
    return query select 'revocado'::text, null::uuid, null::uuid;
    return;
  end if;
  if fila.expires_at <= now() then
    return query select 'caducado'::text, null::uuid, null::uuid;
    return;
  end if;

  -- YA DENTRO NO GASTA USO. Volver a abrir el enlace que te pasaron —porque lo
  -- tienes en el chat y lo pulsas otra vez— no puede consumir una plaza del
  -- grupo. Se contesta que sí y se acaba.
  -- «Ya dentro» es QUIEN YA PODIA ENTRAR, no solo quien tiene fila en las dos
  -- tablas. Se probo con la version corta y el dueño de la organizacion gastaba
  -- un uso al abrir su propio enlace para comprobarlo: llega al espacio por ser
  -- administrador, no por `workspace_members`, asi que la comprobacion no lo
  -- veia dentro. Quien prueba su enlace antes de pasarlo no puede quitarle una
  -- plaza al grupo.
  if exists (
    select 1 from public.organization_members m
     where m.organization_id = fila.organization_id
       and m.user_id = _user
       and (
         fila.workspace_id is null
         or m.all_workspaces
         or m.role in ('owner','admin')
         or exists (
           select 1 from public.workspace_members w
            where w.workspace_id = fila.workspace_id and w.user_id = _user
         )
         or exists (
           select 1 from public.workspaces ws
            where ws.id = fila.workspace_id and ws.created_by = _user
         )
       )
  ) then
    return query select 'ya-dentro'::text, fila.organization_id, fila.workspace_id;
    return;
  end if;

  -- El contador y el tope, en la misma sentencia. Ver la cabecera.
  update public.invite_links l
     set uses = l.uses + 1
   where l.id = fila.id and l.uses < l.max_uses
  returning * into fila;

  if not found then
    return query select 'agotado'::text, null::uuid, null::uuid;
    return;
  end if;

  -- `all_workspaces` depende del alcance: un enlace de organización mete a la
  -- organización entera; uno de espacio, solo a ese espacio y a los que le den
  -- después. Ver la cabecera.
  insert into public.organization_members (organization_id, user_id, role, all_workspaces)
  values (fila.organization_id, _user, fila.role, fila.workspace_id is null)
  on conflict (organization_id, user_id) do nothing;

  if fila.workspace_id is not null then
    insert into public.workspace_members (workspace_id, user_id)
    values (fila.workspace_id, _user)
    on conflict do nothing;
  end if;

  return query select 'dentro'::text, fila.organization_id, fila.workspace_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- A dónde lleva un enlace, antes de usarlo
-- ---------------------------------------------------------------------------
--
-- TAMBIÉN `security definer`, Y POR EL MISMO MOTIVO QUE EL CANJE: quien abre el
-- enlace no pertenece a nada, así que la política de `invite_links` no le deja
-- ver ni que existe. Se intentó primero con una consulta normal y contestaba
-- «ese enlace no existe» a un enlace perfectamente válido.
--
-- ENSEÑA LO JUSTO PARA DECIDIR: a qué organización y a qué espacio te invitan,
-- y si el enlace sigue sirviendo. Nada de quién lo creó, cuánta gente entró ni
-- cuántos usos quedan — eso es de quien administra, y para saberlo hay que
-- tener el enlace en la mano, que es una credencial.
--
-- NO GASTA USO. Mirar a dónde lleva algo antes de pulsarlo no puede costarle
-- una plaza al grupo.
create or replace function public.invite_link_destino(_token_hash text)
returns table (organizacion text, espacio text, expirado boolean, agotado boolean, revocado boolean)
language sql
stable
security definer
set search_path = public
as $$
  select o.name, w.name,
         l.expires_at <= now(),
         l.uses >= l.max_uses,
         l.revoked_at is not null
    from public.invite_links l
    join public.organizations o on o.id = l.organization_id
    left join public.workspaces w on w.id = l.workspace_id
   where l.token_hash = _token_hash;
$$;
