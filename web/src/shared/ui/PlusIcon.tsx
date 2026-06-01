import PlusSvgIcon from "@iconify-react/lucide/plus";

type PlusIconProps = {
  size?: number;
};

export function PlusIcon({ size = 14 }: PlusIconProps) {
  // Exported as PlusIcon for gradual migration — doesn't force business components to rename all at once.
  return <PlusSvgIcon width={String(size)} height={String(size)} />;
}
