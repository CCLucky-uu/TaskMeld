import type { ArtifactManifest } from "../runtime-model";

/** 状态转换命令：标注谁在请求这次状态变更，不同命令拥有不同权限。 */
export type StateTransitionCommand =
  | "execute"        // 普通执行路径
  | "dependency"     // 依赖推进（scheduler 标记 ready/waiting/skipped/blocked）
  | "sleep"          // sleepUntil 唤醒
  | "retry_reset"    // 重试重置
  | "reject_reset"   // 打回重置
  | "route_backfill" // 路由初始化回填（复制祖先状态）
  | "group_aggregate"; // 并行组聚合

export type StateTransitionContext = {
  reason: string;
  command?: StateTransitionCommand;
  now?: string;
  error?: string | null;
  wakeAt?: string | null;
  artifacts?: ArtifactManifest[];
};
