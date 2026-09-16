-- ---------------------------------------------------------------------------
-- 0068 · Repositorios alojados: un git de verdad dentro de DevUP
-- ---------------------------------------------------------------------------
--
-- MISMA DECISIÓN QUE EN 0066, Y POR EL MISMO MOTIVO. Se pidió «poder subir los
-- repositorios» y se planteó dejarlo como un simulacro creíble. Fingirlo bien
-- —un listado de commits inventado, un historial de mentira— es más trabajo que
-- hacerlo y encima es mentira: git es un programa que ya está en el servidor y
-- habla un protocolo por HTTP que se puede servir. Así que `git clone` y
-- `git push` contra DevUP funcionan de verdad, con el git de cualquiera.
--
-- ESTA TABLA NO GUARDA EL REPOSITORIO. El repositorio vive en disco, en el
-- volumen del servicio; aquí solo está el rastro: de quién es, cómo se llama y
-- qué tamaño ocupa. Igual que `hosted_databases` no guarda la base.
--
-- POR QUÉ `slug` Y NO EL NOMBRE A PELO. El nombre acaba siendo una CARPETA en
-- el disco del servidor, así que lo que se guarda está restringido por un
-- `check` a minúsculas, dígitos y guiones. No es cosmética: es la mitad de la
-- defensa contra que alguien llame a su repositorio `../../etc` y el servidor
-- escriba donde no debe. La otra mitad está en el código, que además comprueba
-- el nombre antes de tocar el disco — dos veces, porque esta es la clase de
-- fallo que no avisa cuando falla.

create table if not exists public.hosted_repos (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  slug            text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$'),
  description     text not null default '' check (length(description) <= 300),
  -- La rama por defecto con la que nace. Se guarda porque `git clone` de un
  -- repositorio vacío necesita saber a dónde apunta HEAD, y porque cambiarla
  -- después es una operación del repositorio, no una preferencia de la pantalla.
  default_branch  text not null default 'main' check (default_branch ~ '^[A-Za-z0-9._/-]{1,100}$'),
  -- Lo que ocupa en disco, actualizado al recibir un push. Es un dato de
  -- gestión, no de git: sirve para el tope por espacio y para poder decir en
  -- pantalla qué está llenando el volumen.
  size_bytes      bigint not null default 0 check (size_bytes >= 0),
  pushed_at       timestamptz,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  -- El único ya es el índice: no hace falta otro sobre `workspace_id`, porque
  -- una consulta por espacio usa el prefijo de este.
  unique (workspace_id, slug)
);

alter table public.hosted_repos enable row level security;

-- Ver los repositorios del espacio: cualquiera que llegue al espacio.
drop policy if exists hosted_repos_select on public.hosted_repos;
create policy hosted_repos_select on public.hosted_repos for select
  using (public.can_access_workspace(workspace_id));

-- CREAR Y BORRAR PIDEN MANDO, igual que alojar una base (0066) y por lo mismo:
-- un repositorio consume disco del servidor de todos, y borrarlo se lleva el
-- historial entero sin vuelta atrás.
drop policy if exists hosted_repos_insert on public.hosted_repos;
create policy hosted_repos_insert on public.hosted_repos for insert
  with check (public.can_manage_workspace(workspace_id));

drop policy if exists hosted_repos_delete on public.hosted_repos;
create policy hosted_repos_delete on public.hosted_repos for delete
  using (public.can_manage_workspace(workspace_id));

-- Actualizar sí lo puede hacer cualquiera del espacio: lo que se actualiza es
-- el tamaño y la fecha del último push, y eso lo escribe el propio servidor
-- cuando alguien empuja. Exigir mando aquí impediría empujar a quien puede
-- escribir en el proyecto.
drop policy if exists hosted_repos_update on public.hosted_repos;
create policy hosted_repos_update on public.hosted_repos for update
  using (public.can_access_workspace(workspace_id))
  with check (public.can_access_workspace(workspace_id));

-- ---------------------------------------------------------------------------
-- Contraseñas de git
-- ---------------------------------------------------------------------------
--
-- POR QUÉ HACE FALTA UNA TABLA NUEVA Y NO VALE LA SESIÓN. `git push` lo hace un
-- programa de consola que no tiene cookies ni sabe renovar nada: pide usuario y
-- contraseña y las manda por `Authorization: Basic`. La sesión de DevUP dura
-- quince minutos y rota; como contraseña de git sería inservible al rato.
--
-- Y POR QUÉ NO REUTILIZAR EL TOKEN DE REFRESCO, que sí es de larga duración:
-- porque ese abre la aplicación ENTERA. Una credencial que alguien pega en la
-- configuración de su git, o en un fichero de CI, no debe poder leer los
-- mensajes de su equipo. Esta solo sirve para hablar con los repositorios.
--
-- SE GUARDA EL HASH, NO LA CONTRASEÑA. Quien consiga leer esta tabla no puede
-- empujar nada con lo que encuentre. Se enseña una vez, al crearla, y no vuelve
-- a servirse — mismo trato que la cadena de conexión de una base alojada.

create table if not exists public.git_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  -- Para reconocerla en la lista y poder revocar la correcta: «portátil»,
  -- «el CI». Sin nombre, tres tokens son tres filas iguales.
  name       text not null check (length(btrim(name)) between 1 and 60),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists git_tokens_user_idx
  on public.git_tokens (user_id) where revoked_at is null;

alter table public.git_tokens enable row level security;

-- Cada quien ve, crea y revoca las SUYAS. No hay política de administrador a
-- propósito: son credenciales personales, y que el dueño de una organización
-- pudiera listarlas no le serviría de nada —solo están los hashes— pero sí
-- diría quién tiene cuántas, que no es asunto suyo.
drop policy if exists git_tokens_select on public.git_tokens;
create policy git_tokens_select on public.git_tokens for select
  using (user_id = public.current_user_id());

drop policy if exists git_tokens_insert on public.git_tokens;
create policy git_tokens_insert on public.git_tokens for insert
  with check (user_id = public.current_user_id());

drop policy if exists git_tokens_update on public.git_tokens;
create policy git_tokens_update on public.git_tokens for update
  using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id());

drop policy if exists git_tokens_delete on public.git_tokens;
create policy git_tokens_delete on public.git_tokens for delete
  using (user_id = public.current_user_id());

-- ---------------------------------------------------------------------------
-- De quién es una contraseña de git
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER PORQUE CORRE SIN IDENTIDAD. Cuando llega un `git clone` no
-- hay sesión todavía: lo único que trae es la contraseña del `Authorization`.
-- Alguien tiene que poder mirar `git_tokens` antes de saber quién es nadie, y
-- ese alguien es esta función.
--
-- HACE UNA SOLA PREGUNTA, Y ESO ES TODO EL DISEÑO. Traduce contraseña a
-- persona, y se acaba. NO decide si esa persona puede ver el repositorio ni si
-- puede empujar: eso ya lo contestan las políticas de `hosted_repos`, y la API
-- las consulta poniéndose la identidad que esto devuelve. Escribir aquí las
-- reglas de acceso sería tenerlas en dos sitios, y dos comprobaciones del mismo
-- permiso en dos sitios distintos acaban discrepando — es el mismo argumento
-- que ya está escrito en la ruta de alojar una base (0066).
--
-- Devuelve null si la contraseña no vale o está revocada. Para quien llama, los
-- dos casos son el mismo.
create or replace function public.git_token_owner(_token_hash text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select t.user_id
    from public.git_tokens t
   where t.token_hash = _token_hash
     and t.revoked_at is null
   limit 1;
$$;

-- Y marcar que se usó, también sin identidad: la marca se escribe cuando la
-- contraseña acaba de demostrar que vale, o sea justo antes de que haya sesión.
-- Sirve para que en la pantalla se pueda revocar con criterio la que lleva
-- meses sin usarse.
create or replace function public.git_token_usada(_token_hash text)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.git_tokens
     set last_used_at = now()
   where token_hash = _token_hash and revoked_at is null;
$$;
