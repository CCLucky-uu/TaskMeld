import { Children, isValidElement, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import i18n from "../i18n";

type MarkdownViewerProps = {
  content: string;
  className?: string;
};

type CodeBlockProps = {
  blockKey: string;
  className?: string;
  children?: React.ReactNode;
  collapsed: boolean;
  onToggleCollapsed: (key: string) => void;
};

const markdownViewerBaseClassName =
  "block min-w-0 max-w-full text-[13px] leading-[1.45] text-[var(--text)] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:text-[1.6em] [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-[1.35em] [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-[1.18em] [&_h3]:font-semibold [&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:font-semibold [&_h5]:mt-3 [&_h5]:mb-1 [&_h5]:font-semibold [&_h6]:mt-3 [&_h6]:mb-1 [&_h6]:font-semibold [&_p]:my-2 [&_ul]:my-2 [&_ul]:pl-5 [&_ul]:list-disc [&_ol]:my-2 [&_ol]:pl-5 [&_ol]:list-decimal [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--line)] [&_blockquote]:bg-[rgba(255,255,255,0.02)] [&_blockquote]:px-3 [&_blockquote]:py-2 [&_a]:text-[var(--live)] [&_a]:underline [&_table]:w-full [&_table]:border-collapse [&_table]:overflow-hidden [&_table]:text-sm [&_th]:border [&_th]:border-[rgba(142,163,179,0.18)] [&_th]:bg-[rgba(255,255,255,0.03)] [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_td]:border [&_td]:border-[rgba(142,163,179,0.14)] [&_td]:px-2 [&_td]:py-1.5 [&_code]:rounded-none [&_code]:bg-[rgba(255,255,255,0.06)] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-[JetBrains_Mono,monospace] [&_code]:text-[12px] [&_hr]:my-3 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-[var(--line)]";

function MarkdownCodeBlock({ blockKey, className, children, collapsed, onToggleCollapsed }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const lang = useMemo(() => {
    const match = String(className ?? "").match(/language-([\w-]+)/i);
    return (match?.[1] ?? "text").toLowerCase();
  }, [className]);

  const text = useMemo(() => String(children ?? "").replace(/\n$/, ""), [children]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  const handleToggle = () => {
    onToggleCollapsed(blockKey);
  };

  return (
    // 代码块外层显式限制宽度，避免长 JSON 在 grid/flex 容器中把聊天气泡撑穿。
    <div className="my-2 block min-w-0 max-w-full overflow-hidden border border-[rgba(142,163,179,0.14)] bg-[rgba(255,255,255,0.01)]">
      <div
        className="flex cursor-pointer items-center justify-between gap-2 border-b border-[rgba(142,163,179,0.12)] bg-[rgba(255,255,255,0.03)] px-2.5 py-1.75"
        role="button"
        tabIndex={0}
        onClick={handleToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleToggle();
          }
        }}
        aria-label={collapsed ? i18n.t("common:common.expandCodeBlock") : i18n.t("common:common.collapseCodeBlock")}
      >
        <span className="font-[JetBrains_Mono,monospace] text-xs text-[#8ba0b0]">{lang}</span>
        <div className="flex items-center gap-2">
          <button
            className="cursor-pointer border border-(--line) bg-transparent px-2 py-1 text-xs text-(--muted) transition-[border-color,background-color,color] hover:border-[#2a3c4b] hover:bg-[rgba(142,163,179,0.08)]"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void handleCopy();
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      {!collapsed ? (
        // 代码块需要强制占满当前气泡宽度，并允许任意位置断行；
        // 仅靠 break-words 在 pre/code 组合下不稳定，长 JSON/JS 行仍可能按 max-content 撑宽。
        <pre className="m-0 block min-w-0 w-full max-w-full overflow-hidden bg-transparent p-0 whitespace-pre-wrap break-all wrap-anywhere">
          <code
            className={`${className ?? ""} block min-w-0 w-full max-w-full whitespace-pre-wrap break-all rounded-none bg-transparent px-0 py-0 font-[JetBrains_Mono,monospace] text-[13px] leading-[1.45] text-inherit wrap-anywhere`}
          >
            {text}
          </code>
        </pre>
      ) : null}
    </div>
  );
}

export function MarkdownViewer({ content, className = "" }: MarkdownViewerProps) {
  const [collapsedBlocks, setCollapsedBlocks] = useState<Record<string, boolean>>({});
  const toggleCollapsed = (key: string) => {
    setCollapsedBlocks((prev) => ({
      ...prev,
      [key]: !(prev[key] ?? true),
    }));
  };

  return (
    <div className={`${markdownViewerBaseClassName} ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          pre({ node, children }) {
            const first = Children.toArray(children)[0];
            if (!isValidElement(first)) {
              return <pre>{children}</pre>;
            }
            const codeClassName = (first.props as { className?: string }).className;
            const codeChildren = (first.props as { children?: React.ReactNode }).children;
            const codeText = String(codeChildren ?? "").replace(/\n$/, "");
            const lang = String(codeClassName ?? "").toLowerCase();
            const pos = (node as { position?: { start?: { offset?: number } } } | undefined)?.position?.start?.offset;
            const stablePart = typeof pos === "number" ? String(pos) : codeText.slice(0, 64);
            const blockKey = `${lang}::${stablePart}`;
            return (
              <MarkdownCodeBlock
                blockKey={blockKey}
                className={codeClassName}
                collapsed={collapsedBlocks[blockKey] ?? true}
                onToggleCollapsed={toggleCollapsed}
              >
                {codeChildren}
              </MarkdownCodeBlock>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
