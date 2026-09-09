-- ---------------------------------------------------------------------------
-- 0028 · Imágenes (y cualquier archivo) colgando de una tarea
--
-- POR QUÉ NO HAY TABLA NUEVA. Un archivo adjunto a una tarea es el mismo
-- archivo que ya sabe guardar la biblioteca: mismo almacén, mismo enlace
-- firmado con caducidad, mismo barrendero de subidas abandonadas, mismas
-- políticas. Lo único que faltaba era el apunte de a qué tarea pertenece, así
-- que esto es una columna y no un subsistema.
--
-- Y ES LA PRIMERA RELACIÓN REAL ENTRE TAREAS Y OTRO DOMINIO. Hasta ahora
-- `tasks` no tenía ni una columna relacional fuera de tareas —lo único que la
-- unía a los archivos era compartir la tabla de etiquetas, que es taxonomía y
-- no relación—. Va en la dirección de la propuesta de arquitectura: el archivo
-- cuelga del trabajo que lo justifica en vez de vivir en una lista plana.
-- ---------------------------------------------------------------------------

alter table public.files
  add column if not exists task_id uuid references public.tasks(id) on delete cascade;

-- Parcial: la inmensa mayoría de los archivos no son de una tarea, y un índice
-- que solo cubre a los que sí lo son es más pequeño y más rápido de mantener.
create index if not exists files_task_idx
  on public.files (task_id, created_at desc)
  where task_id is not null;

-- ---------------------------------------------------------------------------
-- La política de alta, con una condición más
--
-- Sin esto, alguien con acceso al espacio A podría adjuntar un archivo a una
-- tarea del espacio B pasándole su identificador: la política vieja solo mira
-- el espacio del ARCHIVO, y no había nada que comprobara la tarea.
--
-- La subconjunta lee `tasks`, que es OTRA tabla, así que no cae en la trampa de
-- la 0027 —una política de SELECT que consulta su propia tabla rompe
-- `insert ... returning`—. Y como `tasks` tiene su propio aislamiento, la
-- comprobación falla cerrada: si quien inserta no puede ver la tarea, para esta
-- política la tarea no existe.
-- ---------------------------------------------------------------------------

drop policy if exists files_insert on public.files;
create policy files_insert on public.files for insert
  with check (
    public.can_access_workspace(workspace_id)
    and organization_id = public.org_of_workspace(workspace_id)
    and (channel_id is null or public.can_access_channel(channel_id))
    and (
      task_id is null
      or exists (
        select 1 from public.tasks t
         where t.id = task_id
           and t.workspace_id = files.workspace_id
      )
    )
    and uploaded_by = public.current_user_id()
  );

-- El cambio de tarea de un archivo ya adjunto pasa por la misma comprobación:
-- mover un adjunto a una tarea de otro espacio es la misma fuga por otra
-- puerta.
--
-- Se conserva EXACTAMENTE el resto de la política de la 0002 —«renombrar y
-- reetiquetar lo puede hacer cualquier miembro»— y se le añade solo la
-- condición de la tarea. Apretar de paso lo que ya se permitía sería un cambio
-- de comportamiento que nadie pidió, escondido dentro de otro.
drop policy if exists files_update on public.files;
create policy files_update on public.files for update
  using (public.is_org_member(organization_id))
  with check (
    public.is_org_member(organization_id)
    and (
      task_id is null
      or exists (
        select 1 from public.tasks t
         where t.id = task_id
           and t.workspace_id = files.workspace_id
      )
    )
  );
