import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const appImages = join(repoRoot, "packages/app/assets/images");
const desktopAssets = join(repoRoot, "packages/desktop/assets");
const sourcePath = join(appImages, "thoth-icon-source.png");

await mkdir(desktopAssets, { recursive: true });

async function transparentMark(size) {
  const { data, info } = await sharp(sourcePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let offset = 0; offset < data.length; offset += 4) {
    // The source uses a slightly graded warm-white canvas. Its darkest channel stays above 220,
    // while every real mark color has a much darker channel, so luminance keying removes the
    // complete canvas without erasing the gold, red or ink details.
    const darkestChannel = Math.min(data[offset], data[offset + 1], data[offset + 2]);
    data[offset + 3] = Math.max(0, Math.min(255, Math.round(((235 - darkestChannel) / 24) * 255)));
  }
  return await sharp(data, { raw: info })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

async function roundedContainer(size) {
  const radius = Math.round(size * 0.22);
  const inset = Math.round(size * 0.08);
  const mark = await transparentMark(Math.round(size * 0.67));
  const shell = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="surface" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fffef9"/>
          <stop offset="1" stop-color="#eeeae0"/>
        </linearGradient>
      </defs>
      <rect x="${inset}" y="${inset}" width="${size - inset * 2}" height="${
        size - inset * 2
      }" rx="${radius}" fill="url(#surface)" stroke="#d8d1c2" stroke-width="${Math.max(
        1,
        Math.round(size * 0.008),
      )}"/>
    </svg>`,
  );
  return await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: shell }, { input: mark, gravity: "center" }])
    .png()
    .toBuffer();
}

async function writePng(path, buffer, size) {
  await sharp(buffer)
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(path);
}

const container1024 = await roundedContainer(1024);
const mark1024 = await transparentMark(1024);
await writePng(join(appImages, "icon.png"), container1024, 1024);
await writePng(join(appImages, "android-icon-foreground.png"), mark1024, 1024);
await writePng(join(appImages, "splash-icon.png"), mark1024, 200);
await writePng(join(appImages, "favicon.png"), container1024, 48);
await writePng(join(appImages, "thoth-brand-mark.png"), mark1024, 512);

const desktopIcon = await roundedContainer(512);
await writePng(join(desktopAssets, "icon.png"), desktopIcon, 512);
await writePng(join(desktopAssets, "32x32.png"), desktopIcon, 32);
await writePng(join(desktopAssets, "64x64.png"), desktopIcon, 64);
await writePng(join(desktopAssets, "128x128.png"), desktopIcon, 128);
await writePng(join(desktopAssets, "128x128@2x.png"), desktopIcon, 256);

console.log("Generated Thoth brand assets with transparent platform-safe corners.");
