import type { StockLedgerState } from "@/data/types";

export type FirebaseBackupConfig = {
  apiKey: string;
  databaseUrl: string;
  backupPath: string;
};

export type FirebaseLogin = {
  email: string;
  password: string;
};

export type FirebaseBackupPayload = {
  app: "stock-ledger";
  schemaVersion: 1;
  exportedAt: string;
  device: string;
  data: Partial<StockLedgerState>;
};

type FirebaseAuthResponse = {
  idToken: string;
  localId: string;
  email: string;
  refreshToken: string;
  expiresIn: string;
};

const DEFAULT_BACKUP_PATH = "stock-report/main/backup";
const AUTH_URL = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword";

export function firebaseBackupConfig(): FirebaseBackupConfig | null {
  const apiKey = cleanEnv(process.env.EXPO_PUBLIC_FIREBASE_API_KEY);
  const databaseUrl = cleanDatabaseUrl(process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL);
  const backupPath = cleanPath(process.env.EXPO_PUBLIC_FIREBASE_BACKUP_PATH) || DEFAULT_BACKUP_PATH;

  if (!apiKey || !databaseUrl) return null;
  return { apiKey, databaseUrl, backupPath };
}

export function firebaseConfigured() {
  return Boolean(firebaseBackupConfig());
}

export async function saveFirebaseBackup(snapshot: Partial<StockLedgerState>, login: FirebaseLogin) {
  const config = requireConfig();
  const auth = await signIn(config, login);

  const payload: FirebaseBackupPayload = {
    app: "stock-ledger",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    device: "stock-report-app",
    data: snapshot
  };

  await firebaseRequest(config, `${config.backupPath}.json`, auth.idToken, {
    method: "PUT",
    body: JSON.stringify(payload)
  });

  return payload;
}

export async function loadFirebaseBackup(login: FirebaseLogin) {
  const config = requireConfig();
  const auth = await signIn(config, login);

  const payload = await firebaseRequest<FirebaseBackupPayload | null>(
    config,
    `${config.backupPath}.json`,
    auth.idToken
  );

  if (!payload || payload.app !== "stock-ledger" || !payload.data) {
    throw new Error("No valid Firebase backup found.");
  }

  return payload;
}

async function signIn(config: FirebaseBackupConfig, login: FirebaseLogin) {
  const email = cleanEnv(login.email);
  const password = cleanEnv(login.password);

  if (!email || !password) {
    throw new Error("Firebase email and password required.");
  }

  const response = await fetch(`${AUTH_URL}?key=${encodeURIComponent(config.apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(firebaseAuthError(body));
  }

  return body as FirebaseAuthResponse;
}

async function firebaseRequest<T>(
  config: FirebaseBackupConfig,
  path: string,
  idToken: string,
  init: RequestInit = {}
) {
  const url = `${config.databaseUrl}/${path}${path.includes("?") ? "&" : "?"}auth=${encodeURIComponent(idToken)}`;

  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(firebaseDatabaseError(body));
  }

  return body as T;
}

function requireConfig() {
  const config = firebaseBackupConfig();

  if (!config) {
    throw new Error("Firebase is not configured. Check .env file.");
  }

  return config;
}

function cleanEnv(value: unknown) {
  return String(value || "").trim();
}

function cleanDatabaseUrl(value: unknown) {
  return cleanEnv(value).replace(/\/+$/, "");
}

function cleanPath(value: unknown) {
  return cleanEnv(value).replace(/^\/+|\/+$/g, "").replace(/[.#$/[\]]/g, "-");
}

function firebaseAuthError(body: unknown) {
  const message =
    typeof body === "object" && body && "error" in body
      ? String((body as { error?: { message?: string } }).error?.message || "")
      : "";

  if (message.includes("INVALID_LOGIN_CREDENTIALS") || message.includes("INVALID_PASSWORD")) {
    return "Firebase login not matching.";
  }

  if (message.includes("EMAIL_NOT_FOUND")) {
    return "Firebase user not found.";
  }

  if (message.includes("OPERATION_NOT_ALLOWED")) {
    return "Enable Email/Password sign-in in Firebase Authentication.";
  }

  return message || "Firebase login failed.";
}

function firebaseDatabaseError(body: unknown) {
  const message =
    typeof body === "object" && body && "error" in body
      ? String((body as { error?: string }).error)
      : "";

  if (message.toLowerCase().includes("permission")) {
    return "Firebase database permission denied. Check that Realtime Database rules are published and allow this user.";
  }

  return message || "Firebase database request failed.";
}