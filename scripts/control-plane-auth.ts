import {
  credentialGeneration,
  defaultAdminCredentialsPath,
  hashPassword,
  loadAdminCredentials,
  writeAdminCredentials,
  ADMIN_CREDENTIALS_VERSION,
  AdminCredentialsError
} from "../src/data/delivery-system/adminCredentials";
import { randomBytes } from "node:crypto";
import {
  AuthSessionRegistry,
  authStateRoot
} from "../src/data/delivery-system/authSessionRegistry";

const command = process.argv[2];

if (process.argv[1]?.endsWith("control-plane-auth.ts")) {
  try {
    if (command === "set-admin-password") await setAdminPassword(process.env);
    else if (command === "issue-service-token") issueServiceToken(process.argv[3], process.env);
    else throw new Error("usage: control-plane-auth set-admin-password|issue-service-token");
  } catch (error) {
    const message = error instanceof Error ? error.message : "control_plane_auth_failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

export async function setAdminPassword(
  environment: Readonly<Record<string, string | undefined>>
): Promise<void> {
  const username = environment.AUTOPILOT_ADMIN_USERNAME ?? "";
  const password = environment.AUTOPILOT_ADMIN_PASSWORD ?? "";
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(username) || password.length < 12) {
    throw new Error("invalid_admin_credentials_input");
  }

  const path = defaultAdminCredentialsPath(environment);
  let generation = 1;
  try {
    generation = credentialGeneration(loadAdminCredentials(path)) + 1;
  } catch (error) {
    if (!(error instanceof AdminCredentialsError) || error.code !== "admin_credentials_missing") throw error;
  }
  const passwordHash = await hashPassword(username, password);
  writeAdminCredentials(path, {
    version: ADMIN_CREDENTIALS_VERSION,
    username,
    ...passwordHash,
    credential_generation: generation
  });
  process.stdout.write("Admin password updated.\n");
}

export function issueServiceToken(
  stateDirectory: string | undefined,
  environment: Readonly<Record<string, string | undefined>>
): void {
  const stateDir = stateDirectory?.trim() || environment.CONTROL_PLANE_STATE_DIR?.trim();
  if (!stateDir) throw new Error("usage: control-plane-auth issue-service-token STATE_DIR");
  const rawToken = randomBytes(32).toString("hex");
  new AuthSessionRegistry(authStateRoot(stateDir)).storeServiceToken(rawToken);
  process.stdout.write(`SERVICE_TOKEN=${rawToken}\n`);
  process.stdout.write("Warning: this service token will not be shown again.\n");
}
