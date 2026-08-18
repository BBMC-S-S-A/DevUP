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
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

// --- Tipos compartidos con la API -------------------------------------------
export type User = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  emailVerified: boolean;
};

export type SignupPolicy = {
  mode: "invite" | "open";
  /** Instancia vacía: la primera cuenta siempre se puede crear. */
  bootstrap: boolean;
  requiresEmailVerification: boolean;
};

export type Invitation = {
  organizationName: string;
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
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
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
};

export type FileRecord = {
  id: string;
  organizationId: string;
  workspaceId: string;
  channelId: string | null;
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
};

export type BoardColumn = {
  id: string;
  name: string;
  position: number;
  tasks: Task[];
};

export type OrganizationMember = {
  userId: string;
  role: "owner" | "admin" | "member";
  displayName: string;
  avatarUrl: string | null;
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

/** Catálogo cerrado a propósito: añadir un widget nuevo es tocar este tipo y
 *  la lista de tarjetas del panel, no una migración. */
export type DashboardWidget = "spotify" | "noticias" | "notificaciones" | "enlaces";

export type DashboardPrefs = {
  widgets: DashboardWidget[];
  spotifyMode: "boton" | "expandido";
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
  connectionId: string;
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

export type SpotifyTrack = {
  uri: string;
  name: string;
  artist: string;
  imageUrl: string | null;
  durationMs: number;
};

export type SpotifyQueueTrack = {
  id: string;
  trackUri: string;
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
