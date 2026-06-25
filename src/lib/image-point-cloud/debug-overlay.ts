import { decodePointCloud } from "./pack";
import { cloneRgbaImage, readPngImage, toPngImageSource, writePngImage } from "./png";
import type { DebugOverlayOptions, DecodedPointCloud, EncodedPointCloud } from "./types";

export async function writePointCloudDebugOverlay(options: DebugOverlayOptions): Promise<void> {
  const image = await readPngImage(toPngImageSource(options), options);
  const pointCloud = isEncodedPointCloud(options.pointCloud) ? decodePointCloud(options.pointCloud) : options.pointCloud;

  if (pointCloud.dims.width !== image.width || pointCloud.dims.height !== image.height) {
    throw new Error("pointCloud dimensions do not match debug overlay image dimensions");
  }

  const overlay = cloneRgbaImage(image);
  const markerRadius = options.markerRadius ?? 1;
  const markerColor = options.markerColor ?? [255, 0, 255, 255];
  const maxDimension = Math.max(image.width, image.height);

  for (let pointIndex = 0; pointIndex < pointCloud.pointCount; pointIndex += 1) {
    const x = pointCloud.positions[pointIndex * 3] ?? 0;
    const y = pointCloud.positions[pointIndex * 3 + 1] ?? 0;
    const pixelX = Math.round(x * maxDimension + (image.width - 1) / 2);
    const pixelY = Math.round((image.height - 1) / 2 - y * maxDimension);
    drawMarker(overlay.data, image.width, image.height, pixelX, pixelY, markerRadius, markerColor);
  }

  await writePngImage(options.outputPath, overlay);
}

function isEncodedPointCloud(value: EncodedPointCloud | DecodedPointCloud): value is EncodedPointCloud {
  return typeof (value as EncodedPointCloud).positions === "string";
}

function drawMarker(
  data: Uint8Array,
  width: number,
  height: number,
  pixelX: number,
  pixelY: number,
  radius: number,
  color: readonly [number, number, number, number]
): void {
  for (let y = pixelY - radius; y <= pixelY + radius; y += 1) {
    for (let x = pixelX - radius; x <= pixelX + radius; x += 1) {
      if (x < 0 || y < 0 || x >= width || y >= height) {
        continue;
      }

      const dx = x - pixelX;
      const dy = y - pixelY;
      if (dx * dx + dy * dy > radius * radius) {
        continue;
      }

      const offset = (y * width + x) * 4;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = color[3];
    }
  }
}
