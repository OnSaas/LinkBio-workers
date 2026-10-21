import { describe, expect, it } from "vitest";
import { applyBackupJson } from "@/lib/backup";
import { createStore } from "@/lib/kv";
import {
  DEFAULT_BACKUP_CONFIG,
  DEFAULT_PROFILE,
  DEFAULT_SETTINGS,
  type BackupConfig,
} from "@/lib/types";
import { FakeKv } from "./helpers/fake-kv";

function storedConfig(): BackupConfig {
  return {
    ...DEFAULT_BACKUP_CONFIG,
    autoBackup: false,
    webdav: {
      enabled: true,
      url: "https://dav.example.com/linkbio.json",
      username: "ada",
      password: "secret-pass",
    },
    gist: {
      enabled: true,
      token: "ghp_secret",
      gistId: "abc123",
      filename: "linkbio-backup.json",
    },
  };
}

function payload(backup: BackupConfig) {
  return {
    version: 1,
    exportedAt: "2026-01-01T00:00:00.000Z",
    profile: { ...DEFAULT_PROFILE, name: "Restored" },
    links: [],
    settings: { ...DEFAULT_SETTINGS, theme: "minimal" },
    backup: {
      ...backup,
      autoBackup: true,
      webdav: { ...backup.webdav, url: "https://dav.example.com/new.json", password: "" },
      gist: { ...backup.gist, token: "" },
    },
  };
}

describe("backup credential merge", () => {
  it("leaves backup config untouched on remote restore", async () => {
    const store = createStore(new FakeKv().asNamespace());
    const before = storedConfig();
    await store.setBackupConfig(before);

    const result = await applyBackupJson(store, JSON.stringify(payload(before)));
    expect(result.ok).toBe(true);
    expect(await store.getBackupConfig()).toEqual(before);
    expect((await store.getProfile()).name).toBe("Restored");
  });

  it("keeps secrets and applies other backup fields on manual import", async () => {
    const store = createStore(new FakeKv().asNamespace());
    const before = storedConfig();
    await store.setBackupConfig(before);

    await store.importAll(payload(before));
    const after = await store.getBackupConfig();
    expect(after.webdav.password).toBe("secret-pass");
    expect(after.gist.token).toBe("ghp_secret");
    expect(after.webdav.url).toBe("https://dav.example.com/new.json");
    expect(after.autoBackup).toBe(true);
    expect((await store.getProfile()).name).toBe("Restored");
  });
});
