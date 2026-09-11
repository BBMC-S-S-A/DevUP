-- =============================================================================
-- DevUP · 0034 · Un repositorio de GitHub sin pedir token
--
-- EL PROBLEMA QUE ARREGLA. Hoy no se puede mirar un repositorio sin pegar
-- antes un token de acceso personal, y ese paso es donde se cae la gente: hay
-- que salir a GitHub, entender qué es «alcance fino», elegir cuatro permisos y
-- volver. Para un repositorio público no hace falta nada de eso — la API de
-- GitHub responde sin credencial. El token pasa a ser lo que siempre debió
-- ser: lo que hace falta para lo privado, no para empezar.
--
-- POR QUÉ ESTO ES UN CAMBIO DE ESQUEMA Y NO SOLO DE PANTALLA. `github_repos`
-- no sabía a qué organización pertenecía: lo deducía de su conexión. Sin
-- token no hay conexión, y entonces un repositorio no tiene dueño ni forma de
-- aislarse — que con RLS no significa «se ve mal», significa «no se ve» o,
-- peor, «lo ve quien no debe». Así que la organización pasa a ser columna
-- propia, que es lo que siempre fue en realidad.
--
-- LOS REPOSITORIOS SIN TOKEN NO ENTRAN EN LA PASADA AUTOMÁTICA, y no es un
-- descuido. Sin credencial GitHub da 60 peticiones por hora Y POR IP —
-- compartidas por todo el servidor, no por organización—. Cada lectura de un
-- repositorio gasta cinco, y el barrendero pasa cada diez minutos: un solo
-- repositorio sin token se comería la mitad del cupo de todo DevUP, y dos lo
-- agotarían. Se refrescan cuando alguien lo pide, que es cuando de verdad
-- importa que el dato esté fresco.
-- =============================================================================

alter table public.github_repos
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

-- Los que ya existen sacan su organización de la conexión que los trajo. No
-- hay huérfanos posibles: `connection_id` borraba en cascada.
update public.github_repos r
   set organization_id = c.organization_id
  from public.connections c
 where c.id = r.connection_id
   and r.organization_id is null;

alter table public.github_repos alter column organization_id set not null;

-- Y la conexión deja de ser obligatoria: null = repositorio público leído sin
-- credencial.
alter table public.github_repos alter column connection_id drop not null;

/**
 * Desconectar el token ya no borra los repositorios.
 *
 * La clave foránea era `on delete cascade`, y con la conexión obligatoria eso
 * tenía sentido: sin token no se podía leer nada, así que la fila sobraba.
 * Ahora no — un repositorio público se lee igual sin credencial, y borrarlo
 * porque alguien retiró un token sería tirar lo que sigue funcionando. Pasa a
 * `set null`: pierde el token, no la ficha.
 *
 * Se busca el nombre en el catálogo en vez de escribirlo: el que puso Postgres
 * al crear la tabla es el de siempre, pero darlo por hecho es cómo una
 * migración falla en el único entorno donde nadie la probó.
 */
do $$
declare
  nombre text;
begin
  select con.conname into nombre
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_attribute att on att.attrelid = rel.oid and att.attnum = con.conkey[1]
   where rel.relname = 'github_repos'
     and con.contype = 'f'
     and att.attname = 'connection_id'
     and con.confdeltype <> 'n';

  if nombre is not null then
    execute format('alter table public.github_repos drop constraint %I', nombre);
    alter table public.github_repos
      add constraint github_repos_connection_id_fkey
      foreign key (connection_id) references public.connections(id) on delete set null;
  end if;
end$$;

-- El mismo repositorio no se añade dos veces a la misma organización, tenga
-- token o no. La restricción vieja —(connection_id, full_name)— se queda
-- donde está: con `connection_id` nulo Postgres considera cada fila distinta,
-- así que ya no restringe nada para los públicos, y para los demás dice lo
-- mismo que esta.
create unique index if not exists github_repos_org_full_name
  on public.github_repos (organization_id, full_name);

-- --- Aislamiento, ahora por la columna y no por la conexión ------------------
-- Mismo reparto de siempre: ver es de cualquier miembro, añadir y quitar es de
-- quien administra. Un repositorio gasta cupo compartido de la API de GitHub,
-- así que quién lo mete no es indiferente.

drop policy if exists github_repos_select on public.github_repos;
create policy github_repos_select on public.github_repos for select
  using (public.is_org_member(organization_id));

drop policy if exists github_repos_insert on public.github_repos;
create policy github_repos_insert on public.github_repos for insert
  with check (public.is_org_admin(organization_id));

drop policy if exists github_repos_delete on public.github_repos;
create policy github_repos_delete on public.github_repos for delete
  using (public.is_org_admin(organization_id));

/**
 * UPDATE, que hasta ahora no existía — y su ausencia no se notaba porque
 * nadie actualizaba un repositorio.
 *
 * Ahora sí hace falta: al conectar un token, los repositorios que se añadieron
 * sin él pasan a usarlo. Sin esta política ese UPDATE no falla, actualiza cero
 * filas y sigue — el token queda conectado y sin efecto sobre lo que ya está
 * en la pantalla, que es precisamente el fallo silencioso contra el que avisa
 * la regla 3 del criterio de migraciones. Se descubrió probándolo.
 */
drop policy if exists github_repos_update on public.github_repos;
create policy github_repos_update on public.github_repos for update
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- El barrendero solo ve los que tienen credencial. Ver la cabecera: los
-- públicos se refrescan a petición para no agotar el cupo por IP.
create or replace function public.list_github_repos_for_refresh()
returns table (repo_id uuid, connection_id uuid, full_name text)
language sql
stable
security definer
set search_path = public
as $$
  select id, connection_id, full_name
    from public.github_repos
   where connection_id is not null;
$$;
