/**
 * Pure helpers of the built-in FTP/FTPS transfer layer.
 *
 * `src/lib/file-transfer.ts` pulls in the database pool, which refuses to load
 * without DATABASE_URL. The helpers under test never touch the pool, so a
 * placeholder URL is enough to import the module; anything that needs a real
 * schema is covered by tests/ftp-server.test.ts and scripts/verify-security.ts.
 */
process.env.DATABASE_URL ??= "postgres://placeholder:placeholder@127.0.0.1:1/gsm_test";

import { describe, test } from "node:test";
import assert from "node:assert/strict";

/** Imported lazily so the placeholder DATABASE_URL above is in place first. */
const load = () => import("../src/lib/file-transfer");

describe("transfer setting validation", () => {
  test("accepts a port inside 1-65535 and stores it as a string", async () => {
    const { validateTransferSetting } = await load();
    assert.deepEqual(validateTransferSetting("ftp_port", "2121"), { value: "2121", error: null });
    assert.deepEqual(validateTransferSetting("ftp_port", 2121), { value: "2121", error: null });
    assert.deepEqual(validateTransferSetting("ftp_port", 1), { value: "1", error: null });
  });

  test("rejects a port out of range or not a whole number", async () => {
    const { validateTransferSetting } = await load();
    for (const bad of [0, 65536, -21, "2121.5", "no", "", null]) {
      const result = validateTransferSetting("ftp_port", bad);
      assert.equal(result.value, null, `expected ${String(bad)} to be rejected`);
      assert.ok(result.error);
    }
  });

  test("treats the enable flag as a boolean and nothing else", async () => {
    const { validateTransferSetting } = await load();
    assert.deepEqual(validateTransferSetting("ftp_enabled", true), { value: "true", error: null });
    assert.deepEqual(validateTransferSetting("ftp_enabled", "false"), { value: "false", error: null });
    for (const bad of ["yes", "on", 1, null]) {
      assert.equal(validateTransferSetting("ftp_enabled", bad).value, null);
    }
  });

  test("keeps strings single-token and bounded", async () => {
    const { validateTransferSetting } = await load();
    assert.deepEqual(validateTransferSetting("ftp_bind_host", " 0.0.0.0 "), { value: "0.0.0.0", error: null });
    assert.equal(validateTransferSetting("ftp_masquerade_host", "ftp example.com").value, null);
    assert.equal(validateTransferSetting("ftp_tls_cert", "x".repeat(513)).value, null);
  });

  test("refuses unknown keys instead of storing them", async () => {
    const { validateTransferSetting } = await load();
    const result = validateTransferSetting("ftp_rm_rf", "1");
    assert.equal(result.value, null);
    assert.match(result.error ?? "", /Unknown setting/);
  });

  test("caps a single upload at a sane maximum", async () => {
    const { validateTransferSetting } = await load();
    assert.deepEqual(validateTransferSetting("ftp_max_upload_mb", 0), { value: "0", error: null });
    assert.equal(validateTransferSetting("ftp_max_upload_mb", -1).value, null);
    assert.equal(validateTransferSetting("ftp_max_upload_mb", 2 * 1024 * 1024).value, null);
  });
});

describe("transfer settings layering", () => {
  test("environment alone produces the documented defaults", async () => {
    const { transferSettingsFromEnvOnly, FTP_DEFAULT_PORT, FTP_DEFAULT_PASSIVE_MIN } = await load();
    const settings = transferSettingsFromEnvOnly({});
    assert.equal(settings.enabled, true);
    assert.equal(settings.port, FTP_DEFAULT_PORT);
    assert.equal(settings.bindHost, "0.0.0.0");
    assert.equal(settings.passiveMin, FTP_DEFAULT_PASSIVE_MIN);
    assert.equal(settings.maxUploadMb, 0);
    assert.equal(settings.tlsCertPath, "");
  });

  test("reads the GSM_FTP_* variables", async () => {
    const { transferSettingsFromEnvOnly } = await load();
    const settings = transferSettingsFromEnvOnly({
      GSM_FTP_PORT: "2021",
      GSM_FTP_BIND: "127.0.0.1",
      GSM_FTP_MASQUERADE_HOST: "ftp.example.com",
      GSM_FTP_PASSIVE_PORTS: "40000-40010",
      GSM_FTP_TLS_CERT: "/etc/gsm/ftp.crt",
      GSM_FTP_TLS_KEY: "/etc/gsm/ftp.key",
      GSM_FTP_IDLE_TIMEOUT: "60",
      GSM_FTP_MAX_CONNECTIONS: "8",
      GSM_FTP_MAX_UPLOAD_MB: "512",
    });
    assert.equal(settings.port, 2021);
    assert.equal(settings.bindHost, "127.0.0.1");
    assert.equal(settings.masqueradeHost, "ftp.example.com");
    assert.equal(settings.passiveMin, 40000);
    assert.equal(settings.passiveMax, 40010);
    assert.equal(settings.tlsCertPath, "/etc/gsm/ftp.crt");
    assert.equal(settings.idleTimeoutSeconds, 60);
    assert.equal(settings.maxConnections, 8);
    assert.equal(settings.maxUploadMb, 512);
  });

  test("a stored row wins over the environment", async () => {
    const { transferSettingsFromRows } = await load();
    const settings = transferSettingsFromRows(
      [
        { key: "ftp_port", value: "2222" },
        { key: "ftp_passive_min", value: "55000" },
        { key: "ftp_max_upload_mb", value: "0" },
      ],
      { GSM_FTP_PORT: "2021", GSM_FTP_PASSIVE_PORTS: "40000-40010", GSM_FTP_MAX_UPLOAD_MB: "512" }
    );
    assert.equal(settings.port, 2222);
    assert.equal(settings.passiveMin, 55000);
    // 0 is a real value here ("no cap"), not a missing one: only "" falls through.
    assert.equal(settings.maxUploadMb, 0);
    assert.equal(settings.passiveMax, 40010);
  });

  test("GSM_DISABLE_FTP turns the listener off and a stored row can turn it back on", async () => {
    const { transferSettingsFromRows, transferSettingsFromEnvOnly } = await load();
    assert.equal(transferSettingsFromEnvOnly({ GSM_DISABLE_FTP: "true" }).enabled, false);
    assert.equal(transferSettingsFromEnvOnly({ GSM_FTP_ENABLED: "false" }).enabled, false);
    assert.equal(transferSettingsFromRows([{ key: "ftp_enabled", value: "true" }], { GSM_DISABLE_FTP: "true" }).enabled, true);
  });

  test("a nonsense stored or env number falls back rather than breaking the listener", async () => {
    const { transferSettingsFromRows, transferSettingsFromEnvOnly, FTP_DEFAULT_PORT } = await load();
    assert.equal(transferSettingsFromEnvOnly({ GSM_FTP_PORT: "not-a-port" }).port, FTP_DEFAULT_PORT);
    assert.equal(transferSettingsFromEnvOnly({ GSM_FTP_PORT: "99999" }).port, FTP_DEFAULT_PORT);
    assert.equal(transferSettingsFromRows([{ key: "ftp_port", value: "-4" }], {}).port, FTP_DEFAULT_PORT);
  });
});

describe("passive range parsing", () => {
  test("parses a range, a single port and the empty string", async () => {
    const { parsePassiveRange } = await load();
    assert.deepEqual(parsePassiveRange("50000-50100"), { min: 50000, max: 50100 });
    assert.deepEqual(parsePassiveRange("  50000 - 50100 "), { min: 50000, max: 50100 });
    assert.deepEqual(parsePassiveRange("50000"), { min: 50000, max: 50000 });
    assert.equal(parsePassiveRange(""), null);
    assert.equal(parsePassiveRange(undefined), null);
  });

  test("refuses reversed, privileged and malformed ranges", async () => {
    const { parsePassiveRange } = await load();
    assert.equal(parsePassiveRange("50100-50000"), null);
    assert.equal(parsePassiveRange("21-30"), null);
    assert.equal(parsePassiveRange("50000-70000"), null);
    assert.equal(parsePassiveRange("passive"), null);
  });
});

describe("transfer usernames", () => {
  test("makes a panel username safe for an FTP client", async () => {
    const { transferUsernameFor } = await load();
    assert.equal(transferUsernameFor("Alice Smith"), "alice-smith");
    assert.equal(transferUsernameFor("José"), "jose");
    assert.equal(transferUsernameFor(""), "user");
    assert.equal(transferUsernameFor(".."), "user");
  });

  test("scopes an account to a server with a dot suffix", async () => {
    const { transferUsernameFor } = await load();
    assert.equal(transferUsernameFor("alice", 12), "alice.12");
  });

  test("retries with a numeric suffix when the name is taken", async () => {
    const { transferUsernameFor } = await load();
    assert.equal(transferUsernameFor("alice", null, 1), "alice-2");
    assert.equal(transferUsernameFor("alice", 12, 2), "alice-3.12");
  });

  test("validates the shape the server accepts", async () => {
    const { isValidTransferUsername, transferUsernameFor } = await load();
    assert.equal(isValidTransferUsername("alice-smith"), true);
    assert.equal(isValidTransferUsername("alice.12"), true);
    assert.equal(isValidTransferUsername("Alice"), false);
    assert.equal(isValidTransferUsername("ab"), false);
    assert.equal(isValidTransferUsername("alice/../root"), false);
    assert.equal(isValidTransferUsername(42), false);
    assert.equal(isValidTransferUsername(transferUsernameFor("Some User!", 3)), true);
  });
});

describe("server folders", () => {
  test("the folder name carries the id so two same-named servers stay apart", async () => {
    const { folderNameFor } = await load();
    assert.equal(folderNameFor({ id: 12, name: "My Server!" }), "my-server-12");
    assert.equal(folderNameFor({ id: 13, name: "My Server!" }), "my-server-13");
  });

  test("falls back to the game slug when the name has no usable characters", async () => {
    const { folderNameFor } = await load();
    assert.equal(folderNameFor({ id: 7, name: "🎮🎮", gameSlug: "minecraft-java" }), "minecraft-java-7");
    assert.equal(folderNameFor({ id: 7, name: "" }), "server-7");
  });
});

describe("endpoint description", () => {
  test("prefers the advertised host and falls back to the request host", async () => {
    const { describeTransferEndpoint, transferSettingsFromEnvOnly } = await load();
    const withMasquerade = transferSettingsFromEnvOnly({ GSM_FTP_MASQUERADE_HOST: "ftp.example.com" });
    const picked = describeTransferEndpoint(withMasquerade, "panel.example.com:3000");
    assert.equal(picked.hostOnly, "ftp.example.com");
    assert.equal(picked.host, `ftp.example.com:${withMasquerade.port}`);
    assert.equal(picked.advertised, true);

    const plain = transferSettingsFromEnvOnly({});
    const fallback = describeTransferEndpoint(plain, "10.0.0.5:3000");
    assert.equal(fallback.hostOnly, "10.0.0.5");
    assert.equal(fallback.advertised, false);
  });

  test("says plainly whether the connection is encrypted", async () => {
    const { describeTransferEndpoint, transferSettingsFromEnvOnly } = await load();
    const plain = describeTransferEndpoint(transferSettingsFromEnvOnly({}), "host");
    assert.equal(plain.ftps, false);
    assert.equal(plain.insecure, true);

    const secure = describeTransferEndpoint(
      transferSettingsFromEnvOnly({ GSM_FTP_TLS_CERT: "/etc/gsm/f.crt", GSM_FTP_TLS_KEY: "/etc/gsm/f.key" }),
      "host"
    );
    assert.equal(secure.ftps, true);
    assert.equal(secure.insecure, false);
    assert.match(secure.curlExample("alice"), /--ssl-reqd/);
    assert.match(plain.curlExample("alice"), /^curl -T .* -u 'alice:PASSWORD' ftp:\/\//);
  });
});
