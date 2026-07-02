import { ThothInventoryIcon } from "@/components/icons/thoth-inventory-icon";

interface ThothLogoProps {
  size?: number;
  color?: string;
}

export function ThothLogo({ size = 64, color }: ThothLogoProps) {
  void color;
  return <ThothInventoryIcon name="brand-mark" size={size} />;
}
