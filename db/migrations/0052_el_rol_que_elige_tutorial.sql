-- =============================================================================
-- DevUP · 0052 · El rol que elige tutorial
--
-- POR QUÉ NO VALE EL CAMPO QUE YA HAY. La 0048 puso `organization_members.title`
-- y acertó en dejarlo **libre**: «backend», «diseño», «quien lleva las
-- facturas». Un desplegable cerrado obliga a elegir la casilla que menos te
-- miente, y lo que se quiere saber al cruzarte con alguien es a qué se dedica,
-- no en qué cajón cabe.
--
-- Pero un tutorial por rol necesita lo contrario: una **lista cerrada**. No se
-- puede elegir qué enseñar a partir de un texto que cada cual escribe como
-- quiere — «front», «frontend», «Frontend Dev» y «maquetador» son la misma
-- persona y cuatro cadenas distintas.
--
-- LAS DOS COSAS SON CORRECTAS Y NO SON LA MISMA, así que van en dos columnas.
-- `title` es lo que se enseña a los demás; `rol` es lo que decide qué tutorial
-- se ofrece, y **nada más**. Meterlo todo en un campo obligaba a elegir: o se
-- pierde la libertad del oficio, o los tutoriales dependen de cómo alguien
-- escribió su puesto.
--
-- Y `rol` ES OPCIONAL A PROPÓSITO. Quien no lo diga recibe el tutorial base,
-- que es el que vale para todos. Un campo obligatorio en el alta para elegir un
-- tutorial es un peaje puesto antes de que nadie haya visto el producto.
--
-- ─────────────────────────────────────────────────────────────────────────────
--
-- DE DÓNDE SALE LA LISTA. De cómo se reparte hoy el trabajo en equipos de
-- software, no de cómo se repartía hace diez años. Los clásicos siguen —
-- producto, frontend, backend, QA, diseño— y entran tres que en 2026 ya no son
-- excepción:
--
--   · `plataforma` junta DevOps, SRE e ingeniería de plataforma. Se agrupan
--     porque en un equipo pequeño **son la misma persona**, y separarlos daría
--     tres tutoriales casi idénticos. Alrededor de ocho de cada diez
--     organizaciones grandes tendrán equipo de plataforma al cerrar 2026.
--   · `ia` es el rol que construye producto encima de modelos: evaluaciones,
--     RAG, agentes, coste y latencia. Es contratación nueva, no una variante de
--     backend, y en DevUP tiene su propio recorrido — la puerta MCP y la bóveda.
--   · `datos` cubre ingeniería y análisis, que en equipos de este tamaño
--     también suelen ir juntas.
--
-- POR ORGANIZACIÓN, igual que el oficio: la misma persona es `backend` en un
-- proyecto y `plataforma` en otro, y el tutorial que le sirve no es el mismo.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'rol_de_equipo') then
    create type public.rol_de_equipo as enum (
      'producto',        -- product owner, product manager
      'gestion',         -- scrum master, jefe de proyecto
      'direccion',       -- tech lead, responsable de ingeniería
      'frontend',
      'backend',
      'fullstack',
      'movil',
      'diseno',          -- UX y UI
      'qa',              -- pruebas y calidad
      'datos',           -- ingeniería y análisis de datos
      'ia',              -- producto sobre modelos: evaluación, RAG, agentes
      'plataforma',      -- DevOps, SRE, infraestructura
      'seguridad'
    );
  end if;
end$$;

alter table public.organization_members
  add column if not exists rol public.rol_de_equipo;

comment on column public.organization_members.rol is
  'Lista CERRADA, y solo sirve para elegir qué tutorial se ofrece. No confundir '
  'con `title` (0048), que es el oficio en texto libre y es lo que se le enseña '
  'a los demás; ni con `role`, que es el permiso (owner/admin/member). Nulo = '
  'tutorial base, que vale para todos.';

/**
 * Elegir el propio rol, sin pedirle permiso a nadie.
 *
 * Misma forma que `set_my_title` (0048) y por el mismo motivo: la política de
 * escritura de `organization_members` es de administradores porque en esa fila
 * vive `role`, que da permisos. Esto toca **una columna, de una fila, la de
 * quien llama**, y no admite un `_user` — decir qué tutorial quiero ver no
 * puede convertirse en decidírselo a otro.
 */
create or replace function public.set_my_rol(_org uuid, _rol public.rol_de_equipo)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.organization_members
     set rol = _rol
   where organization_id = _org
     and user_id = public.current_user_id();

  if not found then
    raise exception 'no perteneces a esa organización' using errcode = '42501';
  end if;
end;
$$;
