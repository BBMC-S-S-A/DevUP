-- =============================================================================
-- DevUP · 0053 · Carpetas en la biblioteca
--
-- QUÉ FALTABA. La biblioteca enseña dieciocho archivos en una rejilla plana, y
-- doce de ellos se llaman `image.png`. A partir de ahí no es una biblioteca: es
-- un cajón. Y crece solo — cada captura pegada en un mensaje acaba aquí.
--
-- POR QUÉ CARPETAS SI YA HAY ETIQUETAS (`file_tags`, 0002). Es exactamente la
-- misma decisión que se tomó con las ramas y las etiquetas de tareas en la
-- 0050, y conviene que sea la misma para que el producto se explique con una
-- sola frase:
--
--   · La CARPETA es dónde vive el archivo. Una, y solo una.
--   · La ETIQUETA es lo que cruza. Todas las que hagan falta.
--
-- Si un archivo pudiera estar en dos carpetas, «lo que hay en Diseño» dejaría
-- de ser una lista y pasaría a ser una opinión — el mismo argumento que se
-- escribió en la 0044, y sigue valiendo aquí.
--
-- ─────────────────────────────────────────────────────────────────────────────
--
-- POR ESPACIO Y NO POR ORGANIZACIÓN, igual que las ramas: los archivos ya lo
-- son, y una carpeta que viviera por encima podría contener archivos de dos
-- espacios que no se ven entre sí. Eso no es una carpeta, es una fuga con
-- forma de carpeta.
--
-- SE ANIDAN, y eso trae el problema que casi siempre se olvida: un ciclo. Nada
-- impide en una clave ajena poner A dentro de B y B dentro de A, y el día que
-- pase, cualquier recorrido hacia la raíz se cuelga — no falla, se cuelga, que
-- es peor. El disparador de abajo lo impide y tiene su comprobación.
--
-- BORRAR UNA CARPETA NO BORRA SUS ARCHIVOS (`on delete set null`). Es lo mismo
-- que hizo la 0044 con las categorías y por el mismo motivo: un archivo sin
-- carpeta se enseña perfectamente —en la raíz— y que reorganizar la biblioteca
-- pueda llevarse por delante lo que alguien subió sería una trampa esperando.
-- Las subcarpetas sí se van con ella; sus archivos suben a la raíz.
--
-- QUIÉN PUEDE, Y POR QUÉ NO SE PIDE MÁS. Cualquiera que llegue al espacio, el
-- mismo listón que subir un archivo. Una carpeta es organización, no permiso:
-- los archivos siguen protegidos por lo suyo, y mover uno de carpeta no cambia
-- quién puede abrirlo. Pedir permisos de administrador para crear una carpeta
-- haría que nadie las usara y la biblioteca seguiría siendo un cajón.
-- =============================================================================

create table if not exists public.file_folders (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Nula = está en la raíz. Una carpeta dentro de otra se borra con ella.
  parent_id    uuid references public.file_folders(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 60),
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists file_folders_workspace_idx
  on public.file_folders (workspace_id, parent_id);

-- Dos carpetas con el mismo nombre en el mismo sitio es siempre un error de
-- dedo, nunca una intención. `nulls not distinct` porque la raíz es un sitio:
-- sin eso, se podrían crear cuatro «Diseño» en la raíz y el índice no diría
-- nada, porque NULL nunca es igual a NULL.
create unique index if not exists file_folders_sin_repetir_idx
  on public.file_folders (workspace_id, parent_id, lower(btrim(name)))
  nulls not distinct;

alter table public.files
  add column if not exists folder_id uuid
    references public.file_folders(id) on delete set null;

create index if not exists files_folder_idx
  on public.files (folder_id) where folder_id is not null;

/**
 * Que una carpeta no pueda acabar dentro de sí misma.
 *
 * NO ES UNA PRECAUCIÓN TEÓRICA. Sin esto basta con mover A dentro de B y luego
 * B dentro de A —dos gestos normales, cada uno válido por separado— para que la
 * biblioteca tenga un anillo. Y entonces cualquier recorrido hacia la raíz,
 * como el que hace una ruta de migas de pan, **no falla: se cuelga**. Un fallo
 * que deja la petición colgada es más caro de diagnosticar que uno que revienta.
 *
 * Se comprueba subiendo desde el padre propuesto: si en el camino aparece la
 * propia carpeta, el movimiento la metería dentro de sí misma.
 */
create or replace function public.sin_ciclos_de_carpeta()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  _subiendo uuid := new.parent_id;
  _pasos    int := 0;
begin
  if new.parent_id is null then return new; end if;

  if new.parent_id = new.id then
    raise exception 'una carpeta no puede estar dentro de sí misma' using errcode = '23514';
  end if;

  while _subiendo is not null loop
    if _subiendo = new.id then
      raise exception 'ese movimiento metería la carpeta dentro de sí misma'
        using errcode = '23514';
    end if;

    -- Cinturón por si alguna vez existiera ya un anillo: este bucle no puede
    -- ser el que cuelgue la petición que viene a impedir los anillos.
    _pasos := _pasos + 1;
    if _pasos > 50 then
      raise exception 'la biblioteca está anidada demasiado hondo' using errcode = '54001';
    end if;

    select parent_id into _subiendo from public.file_folders where id = _subiendo;
  end loop;

  return new;
end;
$$;

drop trigger if exists file_folders_sin_ciclos on public.file_folders;
create trigger file_folders_sin_ciclos
  before insert or update of parent_id on public.file_folders
  for each row execute function public.sin_ciclos_de_carpeta();

-- --- Quién la ve y quién la toca ---------------------------------------------
alter table public.file_folders enable row level security;

drop policy if exists file_folders_select on public.file_folders;
create policy file_folders_select on public.file_folders for select
  using (public.can_access_workspace(workspace_id));

drop policy if exists file_folders_write on public.file_folders;
create policy file_folders_write on public.file_folders for all
  using (public.can_access_workspace(workspace_id))
  with check (public.can_access_workspace(workspace_id));
