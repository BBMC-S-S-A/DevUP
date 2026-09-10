-- ---------------------------------------------------------------------------
-- Gemini como segundo proveedor del asistente.
--
-- El asistente hoy solo habla con la clave de Anthropic. Gemini 2.5 Flash y
-- Flash-Lite tienen una capa gratuita real (sin cobrar tokens, con cuota
-- diaria de sobra para un asistente de uso normal), así que quien no quiera
-- gastar nada puede traer una clave de ahí en vez de la de pago.
--
-- Aviso que la pantalla tiene que decir, no solo este comentario: Google usa
-- el contenido de la capa gratuita para mejorar sus productos. Con datos
-- reales de clientes pasando por las herramientas del asistente, eso importa
-- y no se puede callar.
--
-- Mismo patrón que 0030: un valor más en el enum que ya existe, no una tabla
-- nueva. La bóveda no distingue de qué IA es la clave; solo la guarda cifrada
-- y separada de la fila que se puede listar.
-- ---------------------------------------------------------------------------

alter type public.connection_provider add value if not exists 'gemini';
