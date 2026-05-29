/**
 * 支线判定纯规则函数。
 * 无外部依赖，只接受数据参数，供 workflow/validate 和 execution/dependency-check 共同使用。
 */

/** 节点 scope 缓存：nodeId → scopeId (如 "router:a")，null 表示主线。 */
export type NodeScopeMap = Map<string, string | null>;

// ====== Phase 2: 基于显式 branchScopeId 的支线规则 ======

/**
 * 从 workflow 的 route 边推导每个节点的 branch scope。
 * scope 标识 = routerNodeId:routeValue，如 "router:a"。
 * 主线节点 scope 为 null。
 */
export const computeNodeScopes = (
  nodes: Array<{ id: string }>,
  edges: Array<{ from: string; to: string; when: string | null }>,
  explicitScopes?: Map<string, string | null>,
): NodeScopeMap => {
  const scopes = new Map<string, string | null>();

  // 初始化：有显式 scope 的用显式，否则为 null
  for (const node of nodes) {
    scopes.set(node.id, explicitScopes?.get(node.id) ?? null);
  }

  // 从 route 边推导 scope：路由边 from 的 scope 已知时，to 的 scope = fromScope != null ? fromScope : "from:when"
  for (const edge of edges) {
    if (edge.when === null) continue;
    const fromScope = scopes.get(edge.from);
    const targetScope = fromScope != null ? fromScope : `${edge.from}:${edge.when}`;
    const existing = scopes.get(edge.to);
    if (existing == null) {
      scopes.set(edge.to, targetScope);
    }
  }

  // 传播 scope 沿普通依赖边：BFS 确保同一分支内的下游节点继承上游 scope。
  // 多条路径到达节点时，若 scope 一致则合并；若冲突则保留首次设置的 scope。
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (edge.when !== null) continue; // 只传播普通依赖边
      const fromScope = scopes.get(edge.from);
      if (fromScope == null) continue; // 上游无 scope 则不传播
      const toScope = scopes.get(edge.to);
      if (toScope == null) {
        scopes.set(edge.to, fromScope);
        changed = true;
      }
    }
  }

  return scopes;
};

/**
 * 基于 scope 判断边是否为跨支线普通边。
 * 跨支线：when 为 null 且 from 和 to 在不同的 scope 中。
 */
export const isCrossBranchEdgeByScope = (
  edge: { from: string; to: string; when: string | null },
  nodeScopes: NodeScopeMap,
): boolean => {
  if (edge.when !== null) return false;
  const fromScope = nodeScopes.get(edge.from) ?? null;
  const toScope = nodeScopes.get(edge.to) ?? null;
  // 同 scope → 同一分支内，允许
  if (fromScope === toScope) return false;
  // from 有 scope，to 无 scope → 支线结点向主线传播，不阻断（scope 沿依赖边继承）
  if (fromScope != null && toScope == null) return false;
  // from 无 scope（主线），to 有 scope（支线）→ 禁止：主线不能无条件依赖支线内部节点
  // from 和 to 都有 scope 但不同 → 禁止：不同支线之间的跨分支依赖
  return fromScope !== toScope;
};

/** 基于 scope 获取节点的支线身份。null scope = 主线。 */
export const getBranchScope = (nodeId: string, nodeScopes: NodeScopeMap): string | null =>
  nodeScopes.get(nodeId) ?? null;

