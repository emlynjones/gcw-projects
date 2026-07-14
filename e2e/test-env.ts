import path from "path";

/**
 * Shared constants for the e2e harness. Everything here is isolated from the
 * live app: a dedicated port and a throwaway SQLite database under e2e/.
 * Never points at the production /data volume.
 */
export const ROOT = path.resolve(__dirname, "..");
export const TEST_PORT = 3100;
export const BASE_URL = `http://localhost:${TEST_PORT}`;

export const TEST_DB_FILE = path.join(__dirname, ".test-data", "e2e.db");
export const TEST_DATABASE_URL = `file:${TEST_DB_FILE}`;

// Fixed, non-secret values — this DB and server are disposable.
export const TEST_AUTH_SECRET = "e2e-test-secret-not-for-production-0000000000";

export const ADMIN = {
  email: "test@example.com",
  password: "test-password-123",
  name: "Test Admin",
};

export const STORAGE_STATE = path.join(__dirname, ".auth", "user.json");
