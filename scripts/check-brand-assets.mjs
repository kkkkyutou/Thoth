import { readFile } from "node:fs/promises";
import sharp from "sharp";

const assets = [
  "packages/desktop/assets/icon.png",
  "packages/app/assets/images/icon.png",
  "packages/app/assets/images/android-icon-foreground.png",
  "packages/app/assets/images/splash-icon.png",
  "packages/app/assets/images/thoth-brand-mark.png",
];
for (const path of assets) {
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const cornerAlpha = [
    data[3],
    data[(info.width - 1) * 4 + 3],
    data[(info.height - 1) * info.width * 4 + 3],
    data[(info.width * info.height - 1) * 4 + 3],
  ];
  if (cornerAlpha.some((alpha) => alpha !== 0)) {
    throw new Error(`${path} must have fully transparent corners; got ${cornerAlpha.join(",")}`);
  }
}
const logoSource = await readFile("packages/app/src/components/icons/thoth-logo.tsx", "utf8");
if (logoSource.includes("arcade-inventory/brand/brand-mark.png")) {
  throw new Error("ThothLogo still references the archived Paseo brand mark.");
}
console.log("Thoth brand assets verified.");
