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

  const response = await fetch(`${API_URL}${path}`, {
    ...rest,
    credentials: "include",
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
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
  kind: "mention" | "task_assigned" | "invitation" | "recording";
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
