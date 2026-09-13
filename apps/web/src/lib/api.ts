/**
 * Cliente HTTP de la API.
 *
 * Todo va con `credentials: "include"` porque la sesión vive en cookies
 * httpOnly: el JavaScript de la página no puede leer el token, que es
 * justamente lo que lo protege de un XSS.
 *
 * El token de acceso dura quince minutos. Cuando caduca, la primera petición
 * que falle con 401 dispara un refresco y se reintenta una sola vez. El
 * reintento es único a propósito: si el refresco tampoco vale, la sesión se
 * acabó y hay que volver al acceso, no seguir girando.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = "error",
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Refresco compartido: varias peticiones que caducan a la vez no lanzan N refrescos. */
let refreshing: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
        // Un POST sin datos necesita igualmente cabecera y cuerpo: Fastify
        // contesta 415 si falta `content-type`, y 400 si la cabecera está pero
        // el cuerpo viene vacío. Sin esto el refresco fallaba SIEMPRE, y como
        // el fallo se leía como "no se pudo refrescar", ningún 401 se llegaba
        // a reintentar: la sesión moría al caducar en vez de renovarse.
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      // Se libera en el siguiente tick para que las peticiones que llegaron
      // durante el refresco compartan este resultado y no el siguiente.
      queueMicrotask(() => {
        refreshing = null;
      });
    }
  })();
  return refreshing;
}

type Options = Omit<RequestInit, "body"> & { body?: unknown };

async function request<T>(path: string, options: Options = {}, retry = true): Promise<T> {
  const { body, headers, ...rest } = options;

  // POST, PUT y PATCH llevan cuerpo aunque quien llama no pase ninguno. Marcar
  // un canal como leído o cerrar sesión no tienen datos que mandar, pero Fastify
  // rechaza con 415 un POST sin `content-type`, y con 400 uno que la traiga sin
  // cuerpo. En esos casos se manda un objeto vacío, que las rutas que no leen el
  // cuerpo ignoran sin enterarse.
  const llevaCuerpo = ["POST", "PUT", "PATCH"].includes((rest.method ?? "GET").toUpperCase());

  const response = await fetch(`${API_URL}${path}`, {
    ...rest,
    credentials: "include",
    headers: {
      ...(body !== undefined || llevaCuerpo ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined
      ? { body: JSON.stringify(body) }
      : llevaCuerpo
        ? { body: "{}" }
        : {}),
  });

  if (response.status === 401 && retry && !path.startsWith("/auth/")) {
    if (await refreshSession()) return request<T>(path, options, false);
  }

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = payload as { message?: string; error?: string } | null;
    throw new ApiError(
      response.status,
      detail?.message ?? `Error ${response.status}`,
      detail?.error ?? "error",
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  // PUT y no PATCH donde el cuerpo es el recurso entero: el avatar se manda
  // completo siempre, y mandarlo completo por PATCH invita a que el día que
  // alguien mande media pieza el servidor tenga que adivinar el resto.
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
  // Con cuerpo opcional. Casi ningún borrado lo necesita, pero el de una
  // organización pide escribir su identificador para confirmar cuál se está
  // borrando, y esa confirmación tiene que viajar en el cuerpo: en la URL
  // acabaría en los registros del servidor y en el historial del navegador.
  delete: <T>(path: string, body?: unknown) => request<T>(path, { method: "DELETE", body }),
};

// --- Tipos compartidos con la API -------------------------------------------
export type Presencia = "available" | "busy_open" | "do_not_disturb";

export type User = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  emailVerified: boolean;
  presence: Presencia;
  /** A qué se dedica. Sale en la cartelera de DevVerse. */
  title: string | null;
  /**
   * Su huso horario, en nombre IANA. Nulo = no lo ha dicho, y el servidor usa
   * UTC — que para media Colombia corre los domingos a la semana siguiente.
   */
  timezone: string | null;
  /**
   * Si su cara es el personaje de DevVerse (0058). Cuando es cierto,
   * `avatarUrl` llega nulo aunque haya foto guardada: quien pinta la chapa
   * decide por lo que RECIBE y no por una regla que tenga que recordar.
   */
  usaPersonaje: boolean;
  /** Si ya vio el recorrido de bienvenida (0059). */
  recorridoVisto: boolean;
};

/**
 * Cómo se pinta la cara de alguien, tal como lo resuelve `POST /avatars/urls`.
 *
 * Sin entrada en el mapa = la inicial. Un hueco es una respuesta, no un fallo.
 */
export type Cara =
  | { tipo: "foto"; url: string }
  | { tipo: "personaje"; look: AspectoDePersonaje };

/** Los dieciséis números que describen un personaje (`world_avatars`, 0010). */
export type AspectoDePersonaje = {
  body: number;
  hair: number;
  top: number;
  bottom: number;
  skinTone: number;
  hairTone: number;
  topTone: number;
  bottomTone: number;
  hat: number;
  glasses: number;
  beard: number;
  shoes: number;
  hatTone: number;
  shoesTone: number;
};

export type SignupPolicy = {
  /** Si la instancia tiene configurado entrar con Google. */
  google?: boolean;
  mode: "invite" | "open";
  /** Instancia vacía: la primera cuenta siempre se puede crear. */
  bootstrap: boolean;
  requiresEmailVerification: boolean;
};

export type Invitation = {
  organizationName: string;
  workspaceName: string | null;
  email: string;
  role: "owner" | "admin" | "member";
  invitedByName: string;
  expired: boolean;
  accepted: boolean;
};

export type PendingInvitation = {
  id: string;
  email: string;
  role: string;
  workspaceId: string | null;
  workspaceName: string | null;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  /**
   * Si tiene código corto vivo.
   *
   * OPCIONAL A PROPÓSITO: la ruta que lista invitaciones todavía no lo
   * devuelve. Marcarlo obligatorio mentiría al tipo —sería `undefined` en
   * tiempo de ejecución y TypeScript no diría nada—, que es justo cómo un
   * `boolean` acaba pintando siempre la misma mitad de un rótulo.
   *
   * El código en sí no viaja ni viajará: en la base solo está su hash (0041),
   * así que ni la API puede volver a leerlo.
   */
  hasCode?: boolean;
};

export type Notification = {
  id: string;
  kind: "mention" | "task_assigned" | "invitation" | "recording" | "announcement";
  title: string;
  body: string;
  link: string;
  actorName: string;
  createdAt: string;
  readAt: string | null;
};

export type Organization = {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member";
  createdAt: string;
  /** Clave en el almacén, no URL: hay que pedir `/organizations/:id/logo-url` para pintarla. */
  logoKey?: string | null;
};

export type Workspace = {
  id: string;
  organizationId: string;
  name: string;
  /** `personal` solo lo ve quien lo creó, aunque comparta organización. */
  visibility: "shared" | "personal";
  createdBy: string;
  createdAt: string;
};

export type Channel = {
  id: string;
  workspaceId: string;
  organizationId?: string;
  name: string;
  kind: "text" | "voice";
  isPrivate: boolean;
  createdAt: string;
};

export type Tag = {
  id: string;
  name: string;
  color: string;
  fileCount?: number;
  /**
   * Quién LLEVA la rama, que no es quien tiene sus tareas.
   *
   * Son dos cosas distintas a propósito: quien lleva un área reparte su
   * trabajo, así que puede no tener ninguna tarea suya y seguir respondiendo
   * por ella. Ver la migración 0040.
   */
  ownerId?: string | null;
  ownerName?: string | null;
};

export type FileRecord = {
  id: string;
  organizationId: string;
  workspaceId: string;
  channelId: string | null;
  /** Adjunto de una tarea del tablero, si cuelga de una. */
  taskId: string | null;
  /** De qué llamada salió, si es la grabación de una. */
  callSessionId: string | null;
  name: string;
  description: string;
  mimeType: string;
  sizeBytes: string | number;
  status: "pending" | "ready";
  uploadedBy: string | null;
  uploadedByName: string;
  createdAt: string;
  tags: Tag[];
};

export type Task = {
  id: string;
  workspaceId: string;
  columnId: string;
  title: string;
  description: string;
  position: number;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  tags: Tag[];
  /** Cuantos archivos cuelgan de la tarea. Para el indicador de la tarjeta. */
  adjuntos: number;

  // --- La ficha de desarrollo (migración 0042) -------------------------------
  /** El área del tablero (0039). Nulo = sin clasificar. */
  categoryId: string | null;
  /** Qué clase de trabajo es. Nulo = sin tipar, que es un estado legítimo. */
  tipo: TipoDeTarea | null;
  /** 0 baja · 1 normal · 2 alta · 3 urgente. */
  prioridad: number;
  /** De dónde sale esto: se lee al empezar. */
  contexto: string;
  /** Cómo sabremos que está hecha: se lee al terminar. */
  criterio: string;
  ramas: RamaDeTarea[];
  /** Cuántas pruebas tiene. Enteras solo al abrir la tarjeta. */
  evidencias: number;
  /** Solo viene en la tarea cargada de una en una, no en el tablero. */
  evidencia?: Evidencia[];
};

/**
 * Vocabulario cerrado a propósito, y compartido con la base (ver la 0042): el
 * tipo dice qué clase de trabajo es, y eso no depende del proyecto. El eje que
 * sí se inventa por tablero son las áreas.
 */
export const TIPOS_DE_TAREA = [
  "funcionalidad",
  "arreglo",
  "mejora",
  "deuda",
  "investigacion",
  "documentacion",
  "diseno",
  "infraestructura",
] as const;
export type TipoDeTarea = (typeof TIPOS_DE_TAREA)[number];

export type RamaDeTarea = {
  id: string;
  nombre: string;
  estado: "abierta" | "fusionada" | "descartada";
  repoId: string | null;
  repo: string | null;
};

export type Evidencia = {
  id: string;
  tipo: "pr" | "commit" | "enlace" | "nota";
  url: string | null;
  titulo: string;
  nota: string;
  autorId: string | null;
  autor: string | null;
  creadaEn: string;
};

/**
 * Lo que lleva ganado una persona: `GET /organizations/:orgId/puntos`.
 *
 * `aSolas` NO ES UN DETALLE QUE SE PUEDA DEJAR FUERA AL PINTAR. Los puntos se
 * ganan cerrando tareas (0055), así que quien quiera inflar su número puede
 * crear tareas fáciles y cerrárselas. No se prohíbe —alguien puede montar su
 * proyecto aquí él solo, y eso es lo que atrae—: se dice. Este campo es cuánto
 * de ese total se ganó en tareas por las que no pasó nadie más, y va en la
 * misma línea que el total. Debajo, o en otra vista, es lo mismo que no tenerlo.
 */
export type PuntosDePersona = {
  id: string;
  nombre: string | null;
  total: number;
  aSolas: number;
  tareas: number;
  /** `cerro_tarea` y `dejo_prueba`, con lo sumado en cada uno. */
  porMotivo: Record<string, number>;
};

/** De dónde sale cada punto: `GET /organizations/:orgId/puntos/:personaId`. */
export type AsientoDePuntos = {
  id: string;
  tarea: string | null;
  /** Copiado al ganarlo, así que sigue diciendo de qué tarea vino aunque ya no exista. */
  titulo: string;
  motivo: string;
  cantidad: number;
  aSolas: boolean;
  cuando: string;
};

/**
 * Una rama de trabajo, tal como la devuelve `GET /workspaces/:id/ramas`.
 *
 * NO ES LO MISMO QUE `Tag`, y confundirlas es el error que esta pantalla vino a
 * arreglar. La RAMA es de dónde cuelga el trabajo —una, y solo una, en
 * `task_categories`—; la ETIQUETA es lo que cruza, todas las que hagan falta.
 * Si una tarea pudiera estar en dos ramas, «lo que hay en Frontend» dejaría de
 * ser una lista y pasaría a ser una opinión.
 *
 * `gerentes` va en PLURAL desde la 0050, y no es un adorno: con uno solo, unas
 * vacaciones dejan la rama sin nadie que responda.
 */
export type Rama = {
  id: string;
  nombre: string;
  color: number;
  /** Quién RESPONDE de la rama y reparte su trabajo. Puede no tener ni una tarea suya. */
  gerentes: { id: string; nombre: string | null }[];
  pendientes: number;
  cerradasReciente: number;
  /**
   * Lo que cayó aquí y no tiene delegado.
   *
   * Archivar una tarea en una rama NO asigna a nadie (0050), así que esto no es
   * «lo que no está hecho»: es lo que está esperando a que alguien lo reparta.
   */
  porRepartir: number;
};

/** Lo que se abre al entrar en una rama: `GET /categories/:id/rama`. */
export type DetalleDeRama = {
  porRepartir: { id: string; titulo: string; prioridad: number | null; columna: string }[];
  /**
   * Quién ha andado por aquí, contando las tareas que HOY están en la rama.
   *
   * Mudar una tarea se lleva su historia con ella. Vale para «¿quién sabe de
   * esto?» y NO vale para «¿cuánto se trabajó aquí en septiembre?» — no lo
   * pintes como una gráfica de esfuerzo por mes.
   */
  quienHaTrabajado: {
    id: string;
    nombre: string | null;
    porVerbo: Record<string, number>;
    ultimaVez: string;
  }[];
};

/** Las áreas del tablero (0039): el otro eje, el de «de qué trata y de quién es». */
export type AreaDeTablero = {
  id: string;
  name: string;
  color: number;
  ownerId: string | null;
  ownerName: string | null;
  position: number;
  tareas?: number;
};

export type BoardColumn = {
  id: string;
  name: string;
  position: number;
  /** Si terminar en esta columna cuenta como terminar. Migración 0037. */
  isTerminal: boolean;
  tasks: Task[];
};

export type OrganizationMember = {
  userId: string;
  role: "owner" | "admin" | "member";
  displayName: string;
  avatarUrl: string | null;
  /** A qué se dedica, escrito por la propia persona en su perfil. */
  title: string | null;
  presence: Presencia;
  /** Desde cuándo está en la organización. La API ya lo devolvía. */
  joinedAt: string;
};

export type OrganizationLink = {
  id: string;
  label: string;
  url: string;
  position: number;
  createdAt: string;
};

export type Announcement = {
  id: string;
  organizationId: string;
  title: string;
  body: string;
  authorId: string | null;
  authorName: string;
  createdAt: string;
  updatedAt: string;
};

export type Recording = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  startedByName: string | null;
  fileId: string | null;
  fileName: string | null;
  sizeBytes: string | null;
  mimeType: string | null;
  consents: { displayName: string; granted: boolean }[];
};

export type Connection = {
  id: string;
  provider: "github" | "spotify";
  displayName: string;
  createdAt: string;
};

export type GithubStats = {
  defaultBranch: string;
  openPullRequests: number;
  openIssues: number;
  recentCommits: { sha: string; message: string; author: string; date: string }[];
  latestRun: { status: string; conclusion: string | null; url: string } | null;
};

export type GithubRepo = {
  id: string;
  /** Null = repositorio público, leído sin credencial (migración 0034). */
  connectionId: string | null;
  fullName: string;
  createdAt: string;
  data: GithubStats | null;
  refreshedAt: string | null;
  lastError: string | null;
};

export type GithubTreeEntry = {
  path: string;
  type: "blob" | "tree";
  size?: number;
};

/**
 * Una canción buscable, venga de donde venga.
 *
 * El nombre dice Spotify por historia: hoy YouTube devuelve exactamente esta
 * misma forma, y por eso la lista de resultados no sabe —ni necesita saber— de
 * qué buscador salió cada fila. Lo que distingue la fuente es el prefijo de
 * `uri`: `spotify:track:...` o `youtube:VIDEO_ID`.
 */
export type SpotifyTrack = {
  uri: string;
  name: string;
  artist: string;
  imageUrl: string | null;
  /**
   * Null cuando no se sabe. Pasa con los directos de YouTube —una radio en
   * emisión continua no tiene duración— y con algún vídeo suelto.
   */
  durationMs: number | null;
  isrc: string | null;
};

export type SpotifyQueueTrack = {
  id: string;
  /**
   * El identificador internacional de grabación: lo que identifica a la
   * canción con independencia del servicio. Es lo que hace que esta cola sea
   * del equipo y no de Spotify.
   */
  isrc: string | null;
  /** Su dirección en el servicio desde el que se añadió. Es un atajo, no la
   *  identidad: quien escuche en otro servicio la resuelve por ISRC. */
  trackUri: string | null;
  trackName: string;
  trackArtist: string;
  trackImageUrl: string | null;
  durationMs: number | null;
  addedBy: string | null;
};

export type SpotifySession = {
  trackUri: string | null;
  trackName: string | null;
  trackArtist: string | null;
  trackImageUrl: string | null;
  durationMs: number | null;
  positionMs: number;
  isPlaying: boolean;
  updatedAt: string;
} | null;

export type SearchResult = {
  entity: "message" | "file" | "task" | "client" | "service" | "opportunity";
  id: string;
  title: string;
  snippet: string;
  /** De qué organización sale. Lo que permite buscar en todas sin confundirlas. */
  organizationId: string | null;
  workspaceId: string | null;
  channelId: string | null;
  rank: number;
  createdAt: string;
};

export type Message = {
  id: string;
  channelId: string;
  authorId: string | null;
  authorName: string;
  body: string;
  replyTo: string | null;
  replyPreview: { id: string; authorName: string; body: string } | null;
  fileId: string | null;
  file: { id: string; name: string; mimeType: string; sizeBytes: string } | null;
  createdAt: string;
  editedAt: string | null;
};

export type EstadoDespliegue = "pending" | "running" | "success" | "failure" | "cancelled";

export type Despliegue = {
  id: string;
  state: EstadoDespliegue;
  commitSha: string | null;
  commitMessage: string | null;
  author: string | null;
  logUrl: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type Entorno = {
  id: string;
  name: string;
  kind: "production" | "staging" | "preview";
  url: string | null;
  /** `owner/repo:entorno` en GitHub. Null = entorno anotado a mano. */
  externalId: string | null;
  connectionId: string | null;
  syncedAt: string | null;
  lastError: string | null;
  createdAt: string;
  /** El último despliegue, que es lo que enseña la tarjeta. */
  ultimo: Despliegue | null;
};

export type TipoNodoArquitectura =
  | "servicio"
  | "base_datos"
  | "cola"
  | "cache"
  | "almacenamiento"
  | "api_externa"
  | "otro";

export type NodoArquitectura = {
  id: string;
  kind: TipoNodoArquitectura;
  name: string;
  description: string;
  posX: number;
  posY: number;
  createdAt: string;
};

export type EnlaceArquitectura = {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
};

/**
 * Una sesión abierta. `isAgent` distingue las conexiones de agente —la
 * credencial con la que alguien conecta su Claude por MCP— de los navegadores
 * de siempre; ver la migración 0029.
 */
export type Sesion = {
  id: string;
  userAgent: string;
  label: string;
  isAgent: boolean;
  createdAt: string;
  expiresAt: string;
};

export type ConexionDeAgente = {
  id: string;
  label: string;
  expiresAt: string;
};
