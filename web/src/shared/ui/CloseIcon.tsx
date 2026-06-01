import XIcon from "@iconify-react/lucide/x";

type CloseIconProps = {
  size?: number;
};

export function CloseIcon({ size = 14 }: CloseIconProps) {
  // Use Iconify's official React SVG+CSS approach — standalone icon component, no wrapper.
  return <XIcon width={String(size)} height={String(size)} />;
}
