import XIcon from "@iconify-react/lucide/x";

type CloseIconProps = {
  size?: number;
};

export function CloseIcon({ size = 14 }: CloseIconProps) {
  // 按 Iconify 官方 React SVG+CSS 方案，直接使用独立图标组件。
  return <XIcon width={String(size)} height={String(size)} />;
}
