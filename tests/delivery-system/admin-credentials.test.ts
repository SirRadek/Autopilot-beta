import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ADMIN_CREDENTIALS_VERSION,
  AdminCredentialsError,
  credentialGeneration,
  hashPassword,
  loadAdminCredentials,
  verifyPassword,
  writeAdminCredentials,
  type AdminCredentialStore
} from "../../src/data/delivery-system/adminCredentials";

const USERNAME = "control.admin";
const PASSWORD = "correct horse battery staple";

async function credentialStore(generation = 1): Promise<AdminCredentialStore> {
  return {
    version: ADMIN_CREDENTIALS_VERSION,
    username: USERNAME,
    ...await hashPassword(USERNAME, PASSWORD),
    credential_generation: generation
  };
}

describe("admin credentials", () => {
  it("hashes and asynchronously verifies a password round trip", async () => {
    const store = await credentialStore();

    await expect(verifyPassword(store, USERNAME, PASSWORD)).resolves.toBe(true);
    await expect(verifyPassword(store, USERNAME, "wrong password")).resolves.toBe(false);
  });

  it("uses a length-independent username comparison without throwing on mismatch", async () => {
    const store = await credentialStore();

    await expect(verifyPassword(store, "other.account", PASSWORD)).resolves.toBe(false);
    await expect(verifyPassword(store, "x", PASSWORD)).resolves.toBe(false);
  });

  it("writes and loads a bounded private versioned credential file", async () => {
    const root = mkdtempSync(join(tmpdir(), "admin-credentials-"));
    const path = join(root, "nested", "admin-credentials.json");
    const store = await credentialStore(7);

    writeAdminCredentials(path, store);

    expect(loadAdminCredentials(path)).toEqual(store);
    expect(credentialGeneration(loadAdminCredentials(path))).toBe(7);
    if (process.platform !== "win32") {
      expect(lstatSync(path).mode & 0o777).toBe(0o600);
    }
    expect(readFileSync(path, "utf8")).not.toContain(PASSWORD);
  });

  it.runIf(process.platform !== "win32")("rejects symlinks, oversized files, and group-readable modes", async () => {
    const root = mkdtempSync(join(tmpdir(), "admin-credentials-unsafe-"));
    const target = join(root, "target.json");
    const link = join(root, "link.json");
    writeFileSync(target, JSON.stringify(await credentialStore()), { mode: 0o600 });
    symlinkSync(target, link, "file");

    expect(() => loadAdminCredentials(link)).toThrowError(new AdminCredentialsError("unsafe_admin_credentials_file"));

    const oversized = join(root, "oversized.json");
    writeFileSync(oversized, "x".repeat(70 * 1024), { mode: 0o600 });
    expect(() => loadAdminCredentials(oversized)).toThrowError(new AdminCredentialsError("admin_credentials_file_too_large"));

    const broadMode = join(root, "broad-mode.json");
    writeFileSync(broadMode, JSON.stringify(await credentialStore()), { mode: 0o600 });
    chmodSync(broadMode, 0o640);
    expect(() => loadAdminCredentials(broadMode)).toThrowError(new AdminCredentialsError("unsafe_admin_credentials_mode"));
  });

  it("rejects malformed schema and invalid generations with a typed error", () => {
    const root = mkdtempSync(join(tmpdir(), "admin-credentials-schema-"));
    const path = join(root, "admin-credentials.json");
    writeFileSync(path, JSON.stringify({
      version: ADMIN_CREDENTIALS_VERSION,
      username: USERNAME,
      salt: "00",
      params: { N: 32768, r: 8, p: 1, keylen: 64 },
      hash: "00",
      credential_generation: 0
    }), { mode: 0o600 });

    expect(() => loadAdminCredentials(path)).toThrowError(new AdminCredentialsError("invalid_admin_credentials_schema"));
  });
});
