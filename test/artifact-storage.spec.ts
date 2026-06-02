import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildArtifactStorageDirs, persistArtifactFile } from "../src/pipeline/artifact-storage";
import { listStoredArtifacts, readStoredArtifactContent, type StoredArtifactItem } from "../src/artifacts/storage-service";
import type { PipelineDefinition } from "../src/app/pipeline-config";

const fmtBucket = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const run = async () => {
  // ===== buildArtifactStorageDirs =====
  {
    const d = new Date("2026-05-17T10:00:00Z");
    const b = fmtBucket(d);
    const dirs = buildArtifactStorageDirs("/data/artifacts", "run-001", "success", d);
    assert.equal(dirs.dateBucket, b);
    assert.ok(dirs.runDir.endsWith(join("success", b, "run-001")), `runDir should include status/date/runId: ${dirs.runDir}`);
    assert.ok(dirs.envelopesDir.endsWith(join("run-001", "envelopes")));
    assert.ok(dirs.artifactsDir.endsWith(join("run-001", "artifacts")));
  }

  {
    const d = new Date("2026-01-01T12:00:00Z");
    const b = fmtBucket(d);
    const dirs = buildArtifactStorageDirs("/data/artifacts", "run-002", "failed", d);
    assert.equal(dirs.dateBucket, b);
    assert.ok(dirs.runDir.includes(join("failed", b, "run-002")));
  }

  {
    const d = new Date("2026-06-15T12:00:00Z");
    const b = fmtBucket(d);
    const dirs = buildArtifactStorageDirs("/data/artifacts", "run-003", "rejected", d);
    assert.equal(dirs.dateBucket, b);
    assert.ok(dirs.runDir.includes(join("rejected", b, "run-003")), "rejected status should use same date/runId structure");
  }

  {
    const d = new Date("2026-06-15T12:00:00Z");
    const b = fmtBucket(d);
    const dirs = buildArtifactStorageDirs("/data/artifacts", "run-004", "success", d, "batch-1");
    assert.equal(dirs.dateBucket, b);
    assert.ok(dirs.runDir.includes(join("success", b, "batch-1", "run-004")), "batch run should nest under batchRunId");
    assert.ok(dirs.envelopesDir.includes(join("batch-1", "run-004", "envelopes")));
  }

  // ===== persistArtifactFile =====
  {
    const tempDir = mkdtempSync(join(tmpdir(), "taskmeld-artifact-helper-"));
    const fixedDate = new Date("2026-05-17T10:00:00Z");
    try {
      // 验证真实 SHA-256 hash
      const testPid = "test-pipeline-artifact";
      const manifest1 = await persistArtifactFile(
        tempDir, "success",
        { pipelineId: testPid, runId: "run-001", nodeId: "n1", kind: "artifact" },
        { type: "test.v1", schemaVersion: 1, name: "test-1", content: { foo: "bar" } },
        { savedAt: fixedDate },
      );
      assert.ok(manifest1.hash.startsWith("sha256:"), "hash should be prefixed with sha256:");
      assert.equal(manifest1.hash.length, 71, "sha256 hex digest should be 64 chars + 7-char prefix");
      assert.equal(manifest1.type, "test.v1");
      assert.equal(manifest1.name, "test-1");
      assert.equal(manifest1.sourceNodeId, "n1");

      // 不同内容应产生不同 hash
      const manifest2 = await persistArtifactFile(
        tempDir, "success",
        { pipelineId: testPid, runId: "run-001", nodeId: "n1", kind: "artifact" },
        { type: "test.v1", schemaVersion: 1, name: "test-2", content: { foo: "baz" } },
        { savedAt: fixedDate },
      );
      assert.notEqual(manifest1.hash, manifest2.hash, "different content should produce different hashes");

      // 相同输入应产生相同 hash（传入相同 savedAt 以消除时间戳噪音）
      const manifest3 = await persistArtifactFile(
        tempDir, "success",
        { pipelineId: testPid, runId: "run-001", nodeId: "n1", kind: "artifact" },
        { type: "test.v1", schemaVersion: 1, name: "test-1", content: { foo: "bar" } },
        { savedAt: fixedDate },
      );
      assert.equal(manifest1.hash, manifest3.hash, "same inputs (incl. savedAt) should produce same hash");

      // adapter 产物以统一格式写入 (kind="adapter")
      const adapterManifest = await persistArtifactFile(
        tempDir, "failed",
        { pipelineId: testPid, runId: "run-001", nodeId: "n-adapter", itemKey: "kw-1", kind: "adapter" },
        { type: "executor.error.v1", schemaVersion: 1, name: "domain-output", content: { ok: false } },
        { fileNameSuffix: "kw-1-output" },
      );
      assert.equal(adapterManifest.type, "executor.error.v1");
      assert.ok(adapterManifest.path.includes("failed"), "adapter failed should go to failed dir");

      // group 产物以统一格式写入 (kind="group")
      const groupManifest = await persistArtifactFile(
        tempDir, "success",
        { pipelineId: testPid, runId: "run-001", groupId: "g1", itemKey: "kw-1", kind: "group" },
        {
          type: "group.output.v1", schemaVersion: 1, name: "g1-output",
          content: "group-result", meta: { members: [{ nodeId: "n2" }] },
        },
        { fileNameSuffix: "kw-1-output" },
      );
      assert.equal(groupManifest.type, "group.output.v1");
      assert.equal(groupManifest.sourceNodeId, "g1");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  // ===== listStoredArtifacts + readStoredArtifactContent =====
  const testRoot = mkdtempSync(join(tmpdir(), "taskmeld-artifact-test-"));
  const pipelineId = "test-pipeline";
  const artifactDir = join(testRoot, pipelineId, "artifacts");

  // 新 rejected 产物（结构化目录 rejected/date/runId/artifacts/...）
  const newRejectedDir = join(artifactDir, "rejected", "2026-05-17", "run-rej-001", "artifacts");
  mkdirSync(newRejectedDir, { recursive: true });
  writeFileSync(
    join(newRejectedDir, "run-rej-001-n1-rejected-by-n2-1715932800000-artifact.json"),
    JSON.stringify({
      runId: "run-rej-001",
      nodeId: "n1",
      artifact: { type: "patch.v1", schemaVersion: 1, name: "fix", content: { changes: ["line-1"] }, meta: {} },
    }),
    "utf8",
  );

  // 旧 rejected 产物（扁平路径 rejected/<flat-file>.json）
  const oldRejectedDir = join(artifactDir, "rejected");
  mkdirSync(oldRejectedDir, { recursive: true });
  writeFileSync(
    join(oldRejectedDir, "run-old-001-n3-rejected-by-n4-1700000000000-legacy.json"),
    JSON.stringify({
      runId: "run-old-001",
      nodeId: "n3",
      artifact: { type: "legacy.v1", schemaVersion: 1, name: "legacy", content: { note: "old-format" }, meta: {} },
    }),
    "utf8",
  );

  // success 产物 + envelope
  const successEnvelopeDir = join(artifactDir, "success", "2026-05-17", "run-suc-001", "envelopes");
  const successArtifactDir = join(artifactDir, "success", "2026-05-17", "run-suc-001", "artifacts");
  mkdirSync(successEnvelopeDir, { recursive: true });
  mkdirSync(successArtifactDir, { recursive: true });
  writeFileSync(
    join(successEnvelopeDir, "run-suc-001-n2-uuid-1-envelope.json"),
    JSON.stringify({
      runId: "run-suc-001",
      nodeId: "n2",
      envelope: {
        version: "2.0",
        runId: "run-suc-001",
        nodeId: "n2",
        requestId: "req-1",
        sessionId: "agent:test:main",
        status: "success",
        artifacts: [
          { type: "route.v1", schemaVersion: 1, name: "route", content: { route: "yes" }, meta: { source: "model" } },
        ],
        logs: ["step-1 ok", "step-2 done"],
      },
    }),
    "utf8",
  );
  writeFileSync(
    join(successArtifactDir, "run-suc-001-n2-1-route.v1.json"),
    JSON.stringify({
      runId: "run-suc-001",
      nodeId: "n2",
      artifact: { type: "route.v1", schemaVersion: 1, name: "route", content: { route: "yes" }, meta: { source: "model" } },
    }),
    "utf8",
  );

  // 新统一格式 artifact (含 kind/schemaVersion/batchRunId 顶层字段)
  writeFileSync(
    join(successArtifactDir, "run-suc-001-n3-artifact-kw-out.json"),
    JSON.stringify({
      schemaVersion: 1,
      runId: "run-suc-001",
      batchRunId: null,
      nodeId: "n3",
      groupId: null,
      itemKey: "kw-1",
      requestId: "req-2",
      kind: "artifact",
      savedAt: "2026-05-17T10:00:00.000Z",
      artifact: { type: "patch.v1", schemaVersion: 1, name: "patch", content: { diff: "line-42" }, meta: { size: 1 } },
    }),
    "utf8",
  );

  const definition: PipelineDefinition = {
    id: pipelineId,
    title: "测试流水线",
    workflowFilePath: join(testRoot, pipelineId, "workflow.json"),
    runStateFile: join(testRoot, pipelineId, "run-state.json"),
    artifactDir,
  };

  try {
    const allResult = await listStoredArtifacts([definition]);
    const allArtifacts = allResult.items;
    assert.ok(allResult.source === "scan", "should fall back to scan when no index exists");
    assert.ok(allArtifacts.length >= 3, `should find at least 3 artifacts (new rejected + old rejected + success), got ${allArtifacts.length}`);

    // 新 rejected 产物可查
    const newRejectedItem = allArtifacts.find((a: StoredArtifactItem) => a.status === "rejected" && a.runId === "run-rej-001");
    assert.ok(newRejectedItem, "should find new rejected artifact via listStoredArtifacts");
    if (newRejectedItem) {
      assert.equal(newRejectedItem.dateBucket, "2026-05-17");
      assert.ok(newRejectedItem.relativePath.includes("rejected/2026-05-17/run-rej-001"), `new rejected should be in structured path, got: ${newRejectedItem.relativePath}`);
    }

    // 旧 rejected 扁平文件兼容 — 即使 runId 解析可能失败也应出现在列表中
    const oldRejectedItem = allArtifacts.find((a: StoredArtifactItem) =>
      a.status === "rejected" && a.relativePath.toLowerCase().includes("legacy"),
    );
    assert.ok(oldRejectedItem, "should find old flat rejected file");
    if (oldRejectedItem) {
      // 旧扁平路径 rejected/run-old-001-...legacy.json 应从文件名提取 runId
      assert.equal(oldRejectedItem.runId, "run-old-001", "old rejected should extract runId from filename");
    }

    // envelope 预览返回 contents + logs
    const successEnvelopeItem = allArtifacts.find(
      (a) => a.relativePath.toLowerCase().includes("/envelopes/"),
    );
    assert.ok(successEnvelopeItem, "should find envelope file");
    if (successEnvelopeItem) {
      const content = await readStoredArtifactContent(definition, successEnvelopeItem.relativePath);
      assert.ok(content, "should read envelope content");
      if (content) {
        assert.ok(typeof content.rawText === "string" && content.rawText.length > 0, "rawText should be non-empty");
        const contentObj = content.content as Record<string, unknown> | null;
        assert.ok(contentObj, "envelope content should be an object");
        if (contentObj) {
          assert.ok(Array.isArray(contentObj.logs), "envelope preview should include logs");
          assert.ok(Array.isArray(contentObj.contents), "envelope preview should include contents array");
          assert.ok(contentObj.contents.length > 0, "contents should be non-empty");
        }
      }
    }

    // 新统一格式 artifact (含 kind 字段) 可通过 kind 分发正确读取
    const newFormatItem = allArtifacts.find(
      (a) => a.relativePath.toLowerCase().includes("n3-artifact"),
    );
    assert.ok(newFormatItem, "should find new-format artifact file");
    if (newFormatItem) {
      const newContent = await readStoredArtifactContent(definition, newFormatItem.relativePath);
      assert.ok(newContent, "should read new-format artifact content");
      assert.deepEqual(newContent?.content, { diff: "line-42" }, "new-format artifact content should be extracted");
      assert.deepEqual(newContent?.meta, { size: 1 }, "new-format artifact meta should be extracted");
    }

    // 日期筛选（在索引创建前测试，确保 scan 路径生效）
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const futureFiltered = await listStoredArtifacts([definition], { dateFrom: tomorrow });
    assert.equal(futureFiltered.items.length, 0, "dateFrom in the future should return no results");

    const pastFiltered = await listStoredArtifacts([definition], { dateFrom: "2026-05-01", dateTo: "2026-05-31" });
    assert.ok(pastFiltered.items.length >= 2, `date range should include both structured artifacts, got ${pastFiltered.items.length}`);

    // 索引读取 + cursor 分页
    // persistArtifactFile 写入时会自动追加 index.jsonl
    const idxManifest = await persistArtifactFile(
      artifactDir, "success",
      { pipelineId, runId: "run-idx-001", nodeId: "n-idx", kind: "artifact" },
      { type: "idx.v1", schemaVersion: 1, name: "idx-test", content: { v: 1 } },
      { savedAt: new Date("2026-05-17T12:00:00Z"), fileNameSuffix: "1-idx.v1" },
    );
    assert.ok(idxManifest.hash.startsWith("sha256:"));

    const idxList = await listStoredArtifacts([definition]);
    assert.equal(idxList.source, "index", "should use index when index.jsonl exists");
    assert.ok(idxList.items.length > 0, "index read should return items");

    // 新格式文件名不含 kind 段，nodeId 解析正确（回归审计打回问题）
    const indexedArtifact = idxList.items.find((a: StoredArtifactItem) => a.fileName.includes("idx.v1"));
    assert.ok(indexedArtifact, "should find indexed artifact by filename");
    assert.equal(indexedArtifact?.nodeId, "n-idx", "nodeId should be n-idx, not polluted by kind segment");

    // cursor 分页: limit=1 应返回 nextCursor
    const page1 = await listStoredArtifacts([definition], { limit: 1 });
    assert.equal(page1.items.length, 1, "limit=1 should return 1 item");
    if (page1.nextCursor) {
      const page2 = await listStoredArtifacts([definition], { limit: 1, cursor: page1.nextCursor });
      assert.equal(page2.items.length, 1, "cursor should return next page item");
      assert.notEqual(page1.items[0].relativePath, page2.items[0].relativePath, "cursor pages should not overlap");
    }
  } finally {
    rmSync(testRoot, { recursive: true, force: true });
  }

  console.log("artifact-storage tests passed");
};

void run().catch((error) => {
  console.error("artifact-storage tests failed", error);
  process.exitCode = 1;
});
