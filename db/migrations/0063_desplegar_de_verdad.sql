-- =============================================================================
-- DevUP · 0063 · Desplegar y migrar de verdad, no solo mirar
--
-- CAMBIA UNA DECISIÓN CERRADA DE LA 0021, Y SE ANOTA POR QUÉ. Esa migración
-- decía "DevUP no despliega nada, ORQUESTA" y por eso no tenía ni una columna
-- de configuración de despliegue. Se pidió lo contrario: poder desplegar y
-- migrar desde la propia pantalla de Infraestructura, contra el proveedor que
-- sea — Railway hoy, otros después. Ya no alcanza con leer: hace falta
-- guardar CÓMO se llega a cada entorno para poder actuar sobre él.
--
-- `provider_config` Y NO MÁS COLUMNAS SUELTAS. Cada proveedor necesita datos
-- distintos para ubicar el entorno — Railway pide projectId/serviceId/
-- environmentId; otro proveedor pedirá otra cosa. Una columna JSONB de forma
-- libre es lo que no obliga a una migración nueva cada vez que se suma un
-- proveedor. Nada de esto es secreto: el secreto (el token) sigue viviendo
-- donde ya vivía, en `connection_secrets` de la 0015, referenciado por
-- `connection_id`.
--
-- ADD VALUE Y NO USARLO AQUÍ: Postgres admite añadir un valor a un enum
-- dentro de una transacción, pero no usarlo en la misma — igual que la 0030
-- con `anthropic`. Este archivo solo los añade; quien los usa es el código
-- de la aplicación, después.
-- =============================================================================

alter type public.connection_provider add value if not exists 'railway';
alter type public.connection_provider add value if not exists 'aws';

alter table public.environments
  add column if not exists provider_config jsonb not null default '{}'::jsonb;
