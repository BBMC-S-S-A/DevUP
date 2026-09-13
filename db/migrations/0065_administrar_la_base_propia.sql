-- =============================================================================
-- DevUP · 0065 · Un proveedor más para la bóveda: `postgres`
--
-- Para el administrador de base de datos que se pidió: tablas y SQL de
-- verdad, no solo el criterio de las migraciones (que se queda, es otra
-- pantalla). No es acceso de superusuario a la base compartida de DevUP —
-- eso seguiría rompiendo el aislamiento entre organizaciones que hoy vive en
-- RLS. Es la base de datos QUE CADA WORKSPACE YA TIENE Y YA ADMINISTRA — la
-- misma que hoy abren con psql o con un cliente de escritorio — guardada en
-- la misma bóveda de siempre (0015), con la misma disciplina que Railway o
-- GitHub: un secreto que el equipo ya posee, no uno nuevo que DevUP invente.
--
-- ADD VALUE Y NO USARLO AQUÍ, otra vez: Postgres admite añadir un valor al
-- enum dentro de una transacción, pero no usarlo en la misma (0030, 0063).
-- =============================================================================

alter type public.connection_provider add value if not exists 'postgres';
