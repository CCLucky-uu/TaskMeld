import assert from "node:assert/strict"
import { buildPipelineStatusResult, readPipelineLastCompletedAt } from "../src/services/pipeline-status"

const run = async () => {
  {
    const result = buildPipelineStatusResult({
      pipelineId: "A",
      run: {
        id: "run-single-1",
        status: "running",
        updatedAt: "2026-05-08T00:01:00.000Z",
        nodes: [
          { id: "n1", status: "success", finishedAt: "2026-05-08T00:00:30.000Z" },
          { id: "n2", status: "running", finishedAt: null },
        ],
      },
      scheduler: { enabled: true, mode: "auto" },
      batchRun: { status: "idle", finishedAt: null },
    })
    assert.equal(result.ok, true, "单跑运行态应返回成功结果")
    if (result.ok) {
      assert.equal("status" in result, true, "单跑运行态应返回 status 联合分支")
      if ("status" in result) {
        assert.equal(result.status.mode, "single", "单跑运行态应返回 mode=single")
        assert.equal(result.status.running, true, "单跑运行态应返回 running=true")
      }
    }
  }

  {
    const result = buildPipelineStatusResult({
      pipelineId: "A",
      run: {
        id: "run-batch-2",
        status: "running",
        updatedAt: "2026-05-08T00:02:00.000Z",
        nodes: [
          { id: "n1", status: "success", finishedAt: "2026-05-08T00:01:20.000Z" },
          { id: "n2", status: "running", finishedAt: null },
          { id: "n3", status: "blocked", finishedAt: null },
        ],
        itemRuns: [
          { itemKey: "batch-2", nodeId: "n1", status: "success", finishedAt: "2026-05-08T00:01:20.000Z" },
          { itemKey: "batch-2", nodeId: "n2", status: "running", finishedAt: null },
          { itemKey: "batch-2", nodeId: "n3", status: "blocked", finishedAt: null },
        ],
      },
      scheduler: { enabled: true, mode: "auto" },
      batchRun: {
        status: "running",
        batchSize: 5,
        totalItems: 10,
        processedItems: 5,
        processedBatches: 1,
        totalBatches: 2,
        nextBatchIndex: 2,
        currentBatchIndex: 2,
        currentBatchItemKey: "batch-2",
        currentBatchItems: ["kw-6", "kw-7"],
        finishedAt: null,
      },
    })
    assert.equal(result.ok, true, "批跑运行态应返回成功结果")
    if (result.ok && "status" in result) {
      assert.equal(result.status.mode, "remote_batch", "批跑运行态应返回 mode=remote_batch")
      assert.deepEqual(result.status.currentBatch?.completedNodeIds ?? [], ["n1"], "批跑运行态应返回当前批次已完成节点")
      assert.deepEqual(result.status.currentBatch?.runningNodeIds ?? [], ["n2"], "批跑运行态应返回当前批次运行中节点")
      assert.deepEqual(result.status.currentBatch?.pendingNodeIds ?? [], ["n3"], "批跑运行态应返回当前批次待执行节点")
    }
  }

  {
    const result = buildPipelineStatusResult({
      pipelineId: "A",
      run: {
        id: "run-complete-1",
        status: "success",
        updatedAt: "2026-05-08T12:03:21.116Z",
        nodes: [{ finishedAt: "2026-05-08T12:03:21.100Z" }],
      },
      scheduler: { enabled: true, mode: "auto" },
      batchRun: { status: "idle", finishedAt: null },
    })
    assert.equal(result.ok, true, "非运行态应返回成功结果")
    if (result.ok && !("status" in result)) {
      assert.equal(result.running, false, "非运行态应返回 running=false")
      assert.equal(result.message, "no active pipeline run", "非运行态应返回稳定提示")
      assert.equal(result.lastCompletedAt, "2026-05-08T12:03:21.116Z", "非运行态应返回最近完成时间")
    }
  }

  {
    const result = buildPipelineStatusResult({
      pipelineId: "A",
      run: {
        id: "run-never-complete",
        status: "queued",
        updatedAt: "2026-05-08T12:03:21.116Z",
        nodes: [{ finishedAt: null }],
      },
      scheduler: { enabled: true, mode: "auto" },
      batchRun: { status: "idle", finishedAt: null },
    })
    assert.equal(result.ok, true, "无历史非运行态应返回成功结果")
    if (result.ok && !("status" in result)) {
      assert.equal(result.lastCompletedAt, null, "无历史非运行态应返回 lastCompletedAt=null")
    }
  }

  {
    const lastCompletedAt = readPipelineLastCompletedAt(
      {
        status: "failed",
        updatedAt: "2026-05-08T12:03:21.116Z",
        nodes: [{ finishedAt: "2026-05-08T12:03:20.000Z" }],
      },
      {
        status: "stopped",
        finishedAt: "2026-05-08T12:05:00.000Z",
      },
    )
    // 批跑控制器结束时间更晚时，应优先暴露真实最后完成时间。
    assert.equal(lastCompletedAt, "2026-05-08T12:05:00.000Z", "lastCompletedAt 应取终态中的最新时间")
  }

  console.log("pipeline status semantics tests passed")
}

void run().catch((error) => {
  console.error("pipeline status semantics tests failed", error)
  process.exitCode = 1
})
