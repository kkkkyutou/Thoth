import { useMemo } from "react";
import { Image, type ImageStyle, type StyleProp } from "react-native";

interface ThothLogoProps {
  size?: number;
  color?: string;
  style?: StyleProp<ImageStyle>;
}

/* eslint-disable @typescript-eslint/no-require-imports */
const THOTH_BRAND_MARK = require("../../../assets/icons/arcade-inventory/brand/brand-mark.png");
/* eslint-enable @typescript-eslint/no-require-imports */

export function ThothLogo({ size = 64, color, style }: ThothLogoProps) {
  void color;
  const imageStyle = useMemo(() => [{ width: size, height: size }, style], [size, style]);
  return (
    <Image
      source={THOTH_BRAND_MARK}
      style={imageStyle}
      resizeMode="contain"
      accessible={false}
      accessibilityIgnoresInvertColors
    />
  );
}
