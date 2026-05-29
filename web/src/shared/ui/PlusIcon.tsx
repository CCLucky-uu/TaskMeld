import PlusSvgIcon from "@iconify-react/lucide/plus";

type PlusIconProps = {
  size?: number;
};

export function PlusIcon({ size = 14 }: PlusIconProps) {
  // 这里继续对外暴露 PlusIcon，方便逐步替换，不强迫业务组件一次性改名。
  return <PlusSvgIcon width={String(size)} height={String(size)} />;
}
