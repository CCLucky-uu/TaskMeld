import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TimelineItem } from "./runtime-model";

type TimelineLogEntry = {
  id: string;
  ts: string;
  level: TimelineItem["level"];
  runId: string;
  text: string;
  detail?: unknown;
};

type TimelineLogStoreOptions = {
  rootDir: string;
};

const LOG_FILE_NAME = "timeline.log";

const stringifyTimelineEntry = (entry: TimelineLogEntry) => {
  const seen = new WeakSet<object>();
  return JSON.stringify(entry, (_key, value: unknown) => {
    // 允许完整保留 detail 内容，但循环引用对象本身无法直接 JSON 化，
    // 这里仅做兜底，避免日志持久化因为异常对象而中断主流程。
    if (typeof value !== "object" || value === null) return value;
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return value;
  });
};

export const createTimelineLogStore = (options: TimelineLogStoreOptions) => {
  let writeChain = Promise.resolve();

  const getRunLogFile = (runId: string) => join(options.rootDir, runId, LOG_FILE_NAME);

  const appendTimeline = (runId: string, item: TimelineItem) => {
    const logFile = getRunLogFile(runId);
    let line = `${stringifyTimelineEntry({
      id: item.id,
      ts: item.createdAt,
      level: item.level,
      runId,
      text: item.text,
      ...(item.detail === undefined ? {} : { detail: item.detail }),
    })}\n`;

    // 单行大小兜底，防止超大 detail 撑爆日志文件
    const MAX_LOG_LINE_BYTES = 512 * 1024;
    if (Buffer.byteLength(line, "utf8") > MAX_LOG_LINE_BYTES) {
      const truncated = line.slice(0, MAX_LOG_LINE_BYTES);
      const suffix = "[TRUNCATED_LOG_LINE]\n";
      const suffixBytes = Buffer.byteLength(suffix, "utf8");
      line = truncated.slice(0, MAX_LOG_LINE_BYTES - suffixBytes) + suffix;
    }

    writeChain = writeChain
      .catch(() => {
        // 前一次写盘失败后继续后续写入，避免整个队列永久卡死。
      })
      .then(async () => {
        await mkdir(dirname(logFile), { recursive: true });
        await appendFile(logFile, line, "utf8");
      });

    return writeChain.catch(() => {
      // 日志持久化失败不能影响流水线运行，这里吞掉异常交给调用方按需记录。
    });
  };

  return {
    appendTimeline,
  };
};
