-- =============================================================================
-- DevUP · 0020 · El panel personal pasa de lista a rejilla
--
-- Hasta 0019 el panel era una columna: `user_dashboard_prefs.widgets` guardaba
-- qué widgets y en qué orden, y el orden bastaba porque solo se podía subir y
-- bajar. Ahora cada tarjeta se coloca donde quiera y con el tamaño que quiera,
-- y eso son dos datos más por widget que el orden no puede expresar.
--
-- ADITIVA A PROPÓSITO. `widgets` no se toca y sigue siendo la fuente de qué
-- está puesto y qué no; `layout` solo dice DÓNDE va cada uno de los que están.
-- Separarlo así tiene dos ventajas concretas: quitar un widget no obliga a
-- reescribir posiciones, y una fila de antes de esta migración sigue siendo
-- válida —su `layout` vacío se rellena en el cliente a partir del orden que ya
-- tenía, sin que nadie pierda su panel.
--
-- POR QUÉ JSONB Y NO UNA TABLA DE POSICIONES. Sería una fila por widget y por
-- persona para algo que siempre se lee y se escribe entero, en el mismo gesto
-- (arrastrar una tarjeta reordena las demás). El catálogo de widgets además
-- vive en el código del cliente, no en la base, por la misma razón que se
-- documentó en 0019: añadir uno nuevo no debería exigir una migración.
--
-- SIN POLÍTICA NUEVA. La tabla ya tiene la suya de 0019 —«tu fila, y solo la
-- tuya»— y una columna nueva queda cubierta por ella. Lo que sí hace falta es
-- que el caso de aislamiento correspondiente siga en verde: una columna nueva
-- en una tabla user-scoped es justo el sitio donde se cuela una fuga si la
-- política se hubiera escrito por columnas en vez de por filas.
-- =============================================================================

alter table public.user_dashboard_prefs
  add column if not exists layout jsonb not null default '{}'::jsonb;

comment on column public.user_dashboard_prefs.layout is
  'Posición y tamaño de cada widget en la rejilla: {"spotify":{"x":0,"y":0,"w":2,"h":3}}. '
  'Las unidades son celdas, no píxeles: el ancho real lo decide la pantalla. '
  'Un objeto vacío significa «nunca se ha colocado a mano», y el cliente lo '
  'deriva del orden de `widgets`.';
