import { InlineSelect } from "../../../shared/ui";
import {
  detailPanelActionRowClassName,
  detailPanelClassName,
  detailPanelHeadClassName,
  detailPanelTitleClassName,
} from "./detailPanelClasses";
import { controlInputMonoClassName,controlInputClassName } from "../../../shared/ui/surfaceClassNames";

const groupCheckboxListClassName =
  `${controlInputMonoClassName}  static max-h-[180px] overflow-y-auto overflow-x-hidden p-0`;
const groupOptionClassName =
  "grid min-w-0 cursor-pointer grid-cols-[10px_minmax(0,1fr)] items-center gap-x-3 px-2 py-1.5 text-xs leading-[1.2] text-[var(--text)] transition-[background-color,color] hover:bg-[rgba(142,163,179,0.08)]";
const groupOptionCheckedClassName = "bg-[rgba(50,215,186,0.2)]";
const groupCheckboxClassName =
  "m-0 h-[10px] w-[10px] cursor-pointer appearance-none border border-[var(--line)] bg-transparent transition-[border-color,background-color] hover:border-[#2a3c4b] checked:border-[var(--live)] checked:bg-[var(--live)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--live)] focus-visible:outline-offset-1";
const groupEmptyClassName = "mx-2 my-1.5 text-xs text-[var(--muted)]";
const monoClassName = "font-[JetBrains_Mono,monospace]";
const fieldClassName = "min-w-0";
const fieldLabelClassName = "mb-1.5 block text-xs text-[var(--muted)]";
const fieldCodeClassName =
  "block overflow-wrap-anywhere text-xs whitespace-pre-line break-words border border-[var(--line)] bg-[#0f171d] p-[10px]";
const statusTagBaseClassName = "inline-flex w-fit items-center rounded-none px-2 py-[2px] text-xs uppercase";
const statusTagToneClassName = {
  good: "bg-[rgba(50,215,186,0.15)] text-[var(--live)]",
  live: "bg-[rgba(50,215,186,0.15)] text-[var(--live)]",
  warn: "bg-[rgba(255,184,77,0.16)] text-[var(--warn)]",
  bad: "bg-[rgba(255,107,107,0.16)] text-[var(--bad)]",
  muted: "bg-[rgba(142,163,179,0.2)] text-[#a5b9c8]",
} as const;
const primaryActionButtonClassName =
  "mt-0 cursor-pointer border border-[var(--live-25)] bg-transparent px-[10px] py-2 font-semibold text-[var(--live)] hover:bg-[rgba(50,215,186,0.1)]";
const dangerActionButtonClassName =
  "mt-0 cursor-pointer border border-[var(--bad)] bg-transparent px-[10px] py-2 font-semibold text-[var(--bad)] hover:bg-[rgba(255,107,107,0.1)]";

type GroupDetailPanelProps = {
  selectedGroup?: {
    id: string;
    members: string[];
    upstreams: string[];
    joinPolicy: "all" | "any" | "quorum";
    status: string;
    artifacts: Array<{ type: string; schemaVersion: number; path: string; hash: string }>;
    startedAt: string | null;
    finishedAt: string | null;
    lastError: string | null;
    memberRuns: Array<{ id: string; title: string; status: string; executor: { agentId: string }; artifacts: Array<{ type: string; schemaVersion: number; path: string }> }>;
    itemRuns: Array<{ itemKey: string; status: string; attempt: number; startedAt: string | null; finishedAt: string | null; lastError: string | null }>;
  } | null;
  groupMemberOptions: Array<{ id: string; title: string }>;
  groupUpstreamOptions: Array<{ id: string; title: string }>;
  draftGroupId: string;
  draftGroupMembers: string[];
  draftGroupUpstreams: string[];
  draftGroupJoinPolicy: "all" | "any" | "quorum";
  isSaving: boolean;
  isDeleting?: boolean;
  statusTone: Record<string, string>;
  statusLabel: Record<string, string>;
  onChangeDraftGroupId: (v: string) => void;
  onChangeDraftGroupMembers: (v: string[]) => void;
  onChangeDraftGroupUpstreams: (v: string[]) => void;
  onChangeDraftGroupJoinPolicy: (v: "all" | "any" | "quorum") => void;
  onSave: () => void;
  onDelete?: () => void;
};

export function GroupDetailPanel({
  selectedGroup,
  groupMemberOptions,
  groupUpstreamOptions,
  draftGroupId,
  draftGroupMembers,
  draftGroupUpstreams,
  draftGroupJoinPolicy,
  isSaving,
  isDeleting = false,
  statusTone,
  statusLabel,
  onChangeDraftGroupId,
  onChangeDraftGroupMembers,
  onChangeDraftGroupUpstreams,
  onChangeDraftGroupJoinPolicy,
  onSave,
  onDelete,
}: GroupDetailPanelProps) {
  const toggleValue = (current: string[], id: string, checked: boolean, onChange: (v: string[]) => void) => {
    const next = checked ? [...new Set([...current, id])] : current.filter((item) => item !== id);
    onChange(next);
  };

  return (
    <aside className={detailPanelClassName}>
      <div className={detailPanelHeadClassName}>
        <h2 className={detailPanelTitleClassName}>并行组详情</h2>
        <span className={`${statusTagBaseClassName} ${statusTagToneClassName[(selectedGroup ? statusTone[selectedGroup.status] ?? "muted" : "muted") as keyof typeof statusTagToneClassName]}`}>
          {selectedGroup ? statusLabel[selectedGroup.status] ?? selectedGroup.status : "-"}
        </span>
      </div>
      <div className={fieldClassName}>
        <label className={fieldLabelClassName}>运行时间</label>
        <code className={fieldCodeClassName}>{selectedGroup ? `${selectedGroup.startedAt ?? "-"} -> ${selectedGroup.finishedAt ?? "-"}` : "-"}</code>
      </div>
      <div className={fieldClassName}>
        <label className={fieldLabelClassName}>组 ID</label>
        <input
          className={controlInputMonoClassName}
          value={draftGroupId}
          onChange={(event) => onChangeDraftGroupId(event.target.value)}
          disabled={!selectedGroup}
          placeholder="例如 g_yes_parallel"
        />
      </div>
      <div className={fieldClassName}>
        <label className={fieldLabelClassName}>组内成员</label>
        <div className={groupCheckboxListClassName}>
          {groupMemberOptions.length ? (
            groupMemberOptions.map((node) => (
              <label key={node.id} className={`${groupOptionClassName} ${draftGroupMembers.includes(node.id) ? groupOptionCheckedClassName : ""}`}>
                <input
                  className={groupCheckboxClassName}
                  type="checkbox"
                  checked={draftGroupMembers.includes(node.id)}
                  onChange={(event) => toggleValue(draftGroupMembers, node.id, event.target.checked, onChangeDraftGroupMembers)}
                  disabled={!selectedGroup}
                />
                <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" title={`${node.id} - ${node.title}`}>{node.id} - {node.title}</span>
              </label>
            ))
          ) : (
            <p className={groupEmptyClassName}>暂无可选组成员</p>
          )}
        </div>
        <small className={`${monoClassName} mt-1.5 block text-xs text-(--muted)`}>直接勾选/取消，不再依赖 Ctrl 多选</small>
      </div>
      <div className={fieldClassName}>
        <label className={fieldLabelClassName}>公共上游</label>
        <div className={groupCheckboxListClassName}>
          {groupUpstreamOptions.length ? (
            groupUpstreamOptions.map((item) => (
              <label key={item.id} className={`${groupOptionClassName} ${draftGroupUpstreams.includes(item.id) ? groupOptionCheckedClassName : ""}`}>
                <input
                  className={groupCheckboxClassName}
                  type="checkbox"
                  checked={draftGroupUpstreams.includes(item.id)}
                  onChange={(event) => toggleValue(draftGroupUpstreams, item.id, event.target.checked, onChangeDraftGroupUpstreams)}
                  disabled={!selectedGroup}
                />
                <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" title={`${item.id} - ${item.title}`}>{item.id} - {item.title}</span>
              </label>
            ))
          ) : (
            <p className={groupEmptyClassName}>暂无可选公共上游</p>
          )}
        </div>
      </div>
      <div className={fieldClassName}>
        <label className={fieldLabelClassName}>汇聚策略</label>
        <InlineSelect
          value={draftGroupJoinPolicy}
          options={[
            { value: "all", label: "all" },
            { value: "any", label: "any" },
            { value: "quorum", label: "quorum" },
          ]}
          onChange={(next) => onChangeDraftGroupJoinPolicy(next as "all" | "any" | "quorum")}
          triggerClassName={controlInputClassName}
          disabled={!selectedGroup}
          ariaLabel="选择并行组汇聚策略"
        />
      </div>
      <div className={fieldClassName}>
        <label className={fieldLabelClassName}>成员运行态</label>
        <code className={fieldCodeClassName}>
          {selectedGroup?.memberRuns.length
            ? selectedGroup.memberRuns
                .map((member) => `${member.id} | ${member.title} | ${statusLabel[member.status] ?? member.status} | agent:${member.executor.agentId} | artifacts=${member.artifacts.length}`)
                .join("\n")
            : "空"}
        </code>
      </div>
      <div className={fieldClassName}>
        <label className={fieldLabelClassName}>组 Item 运行</label>
        <code className={fieldCodeClassName}>
          {selectedGroup?.itemRuns.length
            ? selectedGroup.itemRuns
                .map((item) => `${item.itemKey} | ${statusLabel[item.status] ?? item.status} | attempt=${item.attempt} | ${item.startedAt ?? "-"} -> ${item.finishedAt ?? "-"}${item.lastError ? ` | error=${item.lastError}` : ""}`)
                .join("\n")
            : "空"}
        </code>
      </div>
      <div className={fieldClassName}>
        <label className={fieldLabelClassName}>组产物</label>
        <code className={fieldCodeClassName}>
          {selectedGroup?.artifacts.length
            ? selectedGroup.artifacts
                .map((artifact) => `${artifact.type}@v${artifact.schemaVersion} ${artifact.path} (${artifact.hash})`)
                .join("\n")
            : "空"}
        </code>
      </div>
      <div className={fieldClassName}>
        <label className={fieldLabelClassName}>最近错误</label>
        <code className={fieldCodeClassName}>{selectedGroup?.lastError || "空"}</code>
      </div>
      <small className={`${monoClassName} block text-xs text-(--muted)`}>{isSaving ? "并行组保存中..." : "并行组字段需手动保存"}</small>
      <div className={detailPanelActionRowClassName}>
        <button className={primaryActionButtonClassName} type="button" onClick={onSave} disabled={!selectedGroup || isSaving || isDeleting}>
          保存并行组配置
        </button>
        <button className={dangerActionButtonClassName} type="button" onClick={onDelete} disabled={!selectedGroup || isSaving || isDeleting}>
          {isDeleting ? "删除中..." : "删除并行组"}
        </button>
      </div>
    </aside>
  );
}
