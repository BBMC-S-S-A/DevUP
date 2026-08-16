-- =============================================================================
-- DevUP · 0008 · Apagar la vista inmersiva por organización
--
-- Ver docs/decisiones/0002-vistas-profesional-e-inmersiva.md, §6.
--
-- El documento de visión vende DevUP a equipos que necesitan SSO, auditoría y
-- residencia de datos. Un cliente así, en evaluación, no debería descubrir que
-- su plano de control tiene avatares porque alguien de su equipo abrió una
-- pestaña. Que la oficina sea opcional para una persona no basta: tiene que
-- poder no existir para una organización entera.
--
-- Encendida por defecto, y a propósito. Una funcionalidad que hay que ir a
-- buscar a un panel de ajustes no la usa nadie, y el objetivo de esta
-- iteración es justamente medir si se usa. Quien no la quiera la apaga una vez
-- y no vuelve a verla.
--
-- No hace falta política nueva: `organizations_update` ya exige is_org_admin,
-- así que quien pueda cambiar el nombre de la organización puede cambiar esto
-- y nadie más. Es la ventaja de que el aislamiento viva en la base y no
-- repartido por la aplicación — una columna nueva hereda las reglas de su
-- tabla en lugar de necesitar las suyas.
-- =============================================================================

alter table public.organizations
  add column if not exists immersive_enabled boolean not null default true;

comment on column public.organizations.immersive_enabled is
  'Si la vista inmersiva (la oficina) está disponible para esta organización. '
  'Apagarla no borra nada: las plantas y los avatares siguen ahí y vuelven a '
  'aparecer si se enciende otra vez.';

-- ---------------------------------------------------------------------------
-- La comprobación, en un solo sitio
--
-- La usan la ruta del mapa y el socket de la oficina. Está aquí y no repetida
-- en la aplicación porque el día que haya un tercer punto de entrada —una CLI,
-- un agente— la regla tiene que seguir aplicándose sin que nadie se acuerde de
-- copiarla.
--
-- SECURITY DEFINER por la misma razón que el resto de funciones de acceso: se
-- pregunta por una organización a la que quizá se pertenece, y la política de
-- `organizations` ya decide si se puede ver. Aquí solo se devuelve un booleano.
-- ---------------------------------------------------------------------------
create or replace function public.world_enabled_for_workspace(_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select o.immersive_enabled
       from public.workspaces w
       join public.organizations o on o.id = w.organization_id
      where w.id = _workspace),
    false
  );
$$;
