import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const ORIGINAL_ENV = { ...process.env };

async function loadMailTool(outboxDir) {
  process.env.MAIL_OUTBOX_DIR = outboxDir;
  const module = await import("../src/agent/tools/mailTool.js" + `?ts=${Date.now()}`);
  return module.mailTool;
}

describe("mailTool queueReminder", () => {
  let outbox;

  beforeEach(async () => {
    outbox = await mkdtemp(path.join(tmpdir(), "mail-outbox-"));
  });

  afterEach(async () => {
    process.env = { ...ORIGINAL_ENV };
    if (outbox) {
      await rm(outbox, { recursive: true, force: true });
    }
  });

  it("creates reminder file with metadata", async () => {
    const mailTool = await loadMailTool(outbox);
    const result = await mailTool.actions.queueReminder({
      to: "max@example.com",
      cc: ["info@example.com"],
      subject: "Reminder",
      body: "Bitte erledigen",
      meta: { positionId: 42 },
    });

    assert.equal(result.status, "queued");
    assert.ok(result.path.startsWith(outbox));

    const files = await readdir(outbox);
    assert.equal(files.length, 1, "one file should be queued");

    const filePath = path.join(outbox, files[0]);
    const stats = await stat(filePath);
    assert.ok(stats.isFile());

    const content = JSON.parse(await readFile(filePath, "utf8"));
    assert.deepEqual(content.to, ["max@example.com"]);
    assert.deepEqual(content.cc, ["info@example.com"]);
    assert.equal(content.subject, "Reminder");
    assert.equal(content.meta.positionId, 42);
  });

  it("rejects when no recipients provided", async () => {
    const mailTool = await loadMailTool(outbox);
    await assert.rejects(() => mailTool.actions.queueReminder({ to: [] }), {
      message: /muss mindestens eine Adresse enthalten/i,
    });
  });
});
