/**
 * 骨架屏基础组件。
 * 用于异步数据加载期间占位，避免布局跳变（CLS）。
 * 支持矩形、圆形、文本行三种变体，通过子组件的预设类名组合使用。
 */

type SkeletonProps = {
  /** 额外样式类名，控制宽高圆角等 */
  className?: string;
};

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      role="status"
      aria-label="加载中"
      className={`animate-pulse bg-[rgba(142,163,179,0.15)] ${className ?? ""}`}
    />
  );
}

/** 标题骨架: 占位 60% 宽度，模拟标题高度 */
export function SkeletonTitle() {
  return <Skeleton className="mb-2 h-5 w-3/5" />;
}

/** 正文骨架: 占位 90% 宽度，模拟正文高度 */
export function SkeletonBody() {
  return <Skeleton className="mb-1.5 h-4 w-[90%]" />;
}

/** 卡片骨架: 模拟 pipeline/agent 卡片区域的加载态 */
export function SkeletonCard() {
  return (
    <div className="border border-(--line) bg-[linear-gradient(180deg,var(--panel)_0%,var(--panel-2)_100%)] p-4">
      <SkeletonTitle />
      <SkeletonBody />
      <SkeletonBody />
      <Skeleton className="h-4 w-2/5" />
    </div>
  );
}
