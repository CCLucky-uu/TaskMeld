import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { readRunLogPage } from "../src/logs/run-log-reader";

const createEntry = (index: number) =>
  JSON.stringify({
    id: `entry-${index}`,
    ts: new Date(1_700_000_000_000 + index).toISOString(),
    level: "info",
    runId: "run-memory",
    text: `日志 ${index}`,
  });

async function withTempLog<T>(lineCount: number, fn: (filePath: string) => Promise<T>) {
  const dir = await mkdtemp(join(tmpdir(), "taskmeld-run-log-"));
  const filePath = join(dir, "timeline.log");
  try {
    await writeFile(
      filePath,
      Array.from({ length: lineCount }, (_item, index) => createEntry(index + 1)).join("\n"),
      "utf8",
    );
    return await fn(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

void (async () => {
  await withTempLog(350, async (filePath) => {
    const page = await readRunLogPage(filePath, {
      runId: "run-memory",
      order: "desc",
    });

    // 未显式传 limit 的前端查询也要被服务端上限保护，避免大日志一次性压入 V8 堆。
    assert.equal(page.items.length, 300);
    assert.equal(page.limit, 300);
    assert.equal(page.total, 350);
    assert.equal(page.nextOffset, 300);
    assert.equal(page.hasMore, true);
    assert.equal(page.items[0]?.id, "entry-350");
    assert.equal(page.items.at(-1)?.id, "entry-51");
  });
})();
