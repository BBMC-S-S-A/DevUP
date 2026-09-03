-- =============================================================================
-- DevUP · 0025 · La mesa de trabajo
--
-- Partir la pantalla en una, dos o tres zonas y poner en cada una la
-- herramienta que toque: el canal y el tablero, los archivos y el canal, lo que
-- haga falta. Primer paso de la reorganización por sectores — ver
-- Ver docs/LO-QUE-HAY-Y-LO-QUE-FALTA.md.
--
-- POR ESPACIO DE TRABAJO Y NO POR PERSONA A SECAS, que es la diferencia con el
-- panel de 0019. Aquel guarda una preferencia que vale en todas partes —qué
-- widgets quiero ver—; esto guarda con qué estoy trabajando aquí, y eso cambia
-- de un espacio a otro: el canal de un proyecto no existe en el siguiente. Una
-- sola disposición para todos los espacios obligaría a recolocarla cada vez que
-- se cambia de proyecto, que es justo el trabajo que esto viene a quitar.
--
-- EL CATÁLOGO DE HERRAMIENTAS NO ESTÁ AQUÍ. Igual que en 0019: la base guarda
-- qué herramienta y con qué parámetro, y qué herramientas existen lo decide el
-- código del cliente. Añadir una mañana no pide migración.
--
-- LO QUE SÍ SE ACOTA ES EL NÚMERO DE ZONAS. Tres es un tope de diseño, no de
-- implementación: en una pantalla de portátil, cuatro columnas dejan cada
-- herramienta en un carril demasiado estrecho para usarla, y lo que se gana en
-- «cabe todo» se pierde en «no se puede trabajar en ninguna». Si alguna vez
-- hacen falta cuatro, se sube aquí y en el cliente a la vez.
-- =============================================================================

create table if not exists public.user_workbench_prefs (
  user_id      uuid not null references public.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  -- Una lista de zonas, en orden de izquierda a derecha. Cada una:
  --   { "herramienta": "chat", "objetivo": "<uuid del canal>" | null }
  -- `objetivo` es opcional porque la mayoría de herramientas no necesitan uno:
  -- el tablero y los archivos ya saben de qué espacio son.
  zonas        jsonb not null default '[]'::jsonb
    check (jsonb_typeof(zonas) = 'array' and jsonb_array_length(zonas) between 0 and 3),

  -- El ancho de cada zona, en fracciones que suman 1. Fracciones y no píxeles
  -- por el mismo motivo que la rejilla del panel guarda celdas: la misma mesa
  -- tiene que servir en un portátil y en un monitor grande sin recalcular nada.
  fracciones   jsonb not null default '[]'::jsonb
    check (jsonb_typeof(fracciones) = 'array' and jsonb_array_length(fracciones) between 0 and 3),

  updated_at   timestamptz not null default now(),
  primary key (user_id, workspace_id)
);

alter table public.user_workbench_prefs enable row level security;

-- Solo suya, como el panel. Nadie más en la organización la ve ni la toca, ni
-- siquiera quien administra: cómo coloca alguien sus herramientas no es
-- información de la organización, es de la persona.
--
-- Y `can_access_workspace` además del dueño: sin eso, alguien podría guardar
-- disposiciones para espacios a los que no pertenece — invisibles para todos,
-- pero con el identificador de ese espacio dentro, que ya es contar algo que
-- no le habían preguntado.
drop policy if exists user_workbench_prefs_select on public.user_workbench_prefs;
create policy user_workbench_prefs_select on public.user_workbench_prefs for select
  using (user_id = public.current_user_id());

drop policy if exists user_workbench_prefs_insert on public.user_workbench_prefs;
create policy user_workbench_prefs_insert on public.user_workbench_prefs for insert
  with check (
    user_id = public.current_user_id() and public.can_access_workspace(workspace_id)
  );

drop policy if exists user_workbench_prefs_update on public.user_workbench_prefs;
create policy user_workbench_prefs_update on public.user_workbench_prefs for update
  using (user_id = public.current_user_id())
  with check (
    user_id = public.current_user_id() and public.can_access_workspace(workspace_id)
  );

drop policy if exists user_workbench_prefs_delete on public.user_workbench_prefs;
create policy user_workbench_prefs_delete on public.user_workbench_prefs for delete
  using (user_id = public.current_user_id());
