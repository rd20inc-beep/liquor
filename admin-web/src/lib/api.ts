const ACCESS_KEY = 'liquor.access';
const REFRESH_KEY = 'liquor.refresh';
const USER_KEY = 'liquor.user';

export interface AuthUser {
  sub: string;
  role: 'sales' | 'collector' | 'driver' | 'accounts' | 'admin' | 'owner';
  org_id: string;
  name?: string;
}

export const tokens = {
  access: () => localStorage.getItem(ACCESS_KEY),
  refresh: () => localStorage.getItem(REFRESH_KEY),
  set(access: string, refresh: string, user: AuthUser) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  user(): AuthUser | null {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  body?: unknown;
  headers?: Record<string, string>;
  /** Pass false to skip auth (e.g. login/refresh endpoints). */
  auth?: boolean;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, auth = true } = opts;
  const h: Record<string, string> = {
    accept: 'application/json',
    ...headers,
  };
  if (body !== undefined) h['content-type'] = 'application/json';
  if (auth) {
    const tok = tokens.access();
    if (tok) h.authorization = `Bearer ${tok}`;
  }

  const res = await fetch(`/v1${path}`, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth) {
    // Access token expired — try refresh once
    const refreshed = await tryRefresh();
    if (refreshed) {
      const retry = await fetch(`/v1${path}`, {
        method,
        headers: { ...h, authorization: `Bearer ${tokens.access()}` },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      return handleResponse<T>(retry);
    }
    tokens.clear();
    window.location.href = '/login';
    throw new ApiError(401, 'unauthorized', 'Session expired');
  }

  return handleResponse<T>(res);
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      json?.code ?? 'error',
      json?.message ?? res.statusText,
      json?.details,
    );
  }
  return json as T;
}

let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  const refresh = tokens.refresh();
  if (!refresh) return false;
  refreshPromise = (async () => {
    try {
      const res = await fetch('/v1/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { access_token: string };
      const prior = localStorage.getItem(ACCESS_KEY);
      if (data.access_token && prior !== data.access_token) {
        localStorage.setItem(ACCESS_KEY, data.access_token);
      }
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  del: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'DELETE' }),
};
