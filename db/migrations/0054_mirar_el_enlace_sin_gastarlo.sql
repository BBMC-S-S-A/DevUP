-- =============================================================================
-- DevUP · 0054 · Mirar el enlace de recuperación sin gastarlo
--
-- QUÉ FALLA HOY. El correo de «he olvidado la contraseña» lleva a
-- `/recuperar?token=…`. Esa pantalla no pregunta nada al abrirse: enseña el
-- formulario, la persona se inventa una contraseña nueva, la teclea dos veces,
-- la envía — y solo ENTONCES `consume_user_token` responde que no, porque el
-- enlace caducó hace tres días o porque ya lo usó desde el móvil. El trabajo de
-- elegir la contraseña se tira a la basura después de hacerlo, que es el peor
-- momento posible para decir que no.
--
-- POR QUÉ HACE FALTA UNA FUNCIÓN NUEVA Y NO VALE `consume_user_token`. Porque
-- consume: mirar el enlace para pintar la pantalla lo gastaría, y la persona se
-- quedaría sin poder enviarlo. Son dos gestos distintos y necesitan dos
-- funciones distintas — la de mirar es `stable`, no toca nada, y eso es
-- precisamente lo que la hace segura de llamar al abrir la página.
--
-- POR QUÉ DISTINGUE CADUCADO DE USADO DE DESCONOCIDO. Porque cada uno tiene una
-- salida distinta que darle a quien lo lee:
--
--   · caducado    → «pide otro correo», y hay que decirle desde dónde.
--   · usado       → «ya la cambiaste; entra con la nueva». Pedir otro correo
--                   aquí sería mandarle a repetir algo que ya hizo.
--   · desconocido → el enlace viene partido por el cliente de correo, o
--                   recortado al copiarlo. «Pide otro» también, pero el motivo
--                   es otro.
--
-- Y no filtra nada: el token son 32 bytes al azar, así que quien pregunta por
-- uno concreto ya lo tenía. Lo que NO devuelve —a propósito— es de quién es la
-- cuenta: el enlace sirve para cambiar esa contraseña, no para averiguar a qué
-- dirección pertenece si se cae en manos ajenas.
--
-- RLS. No añade tablas. `user_tokens` sigue sin política ninguna desde la 0006
-- —RLS activo y nadie pasa—, y por eso esto va `security definer`, igual que
-- `consume_user_token`. Sus privilegios los reaplica `db/grants.sql`, que
-- recorre todas las SECURITY DEFINER del esquema: se las quita a PUBLIC y se
-- las da solo a devup_app.
-- =============================================================================

create or replace function public.check_user_token(
  _token_hash text,
  _purpose    public.token_purpose
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select case
               when t.used_at is not null  then 'usado'
               when t.expires_at <= now()  then 'caducado'
               else 'valido'
             end
        from public.user_tokens t
       where t.token_hash = _token_hash
         and t.purpose = _purpose
    ),
    'desconocido'
  );
$$;
