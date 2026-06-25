import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";

import { PNG } from "pngjs";

import type { PngDecodeLimits, RgbaImage } from "./types";

export type PngImageSource = { readonly imagePath: string } | { readonly imageBuffer: Uint8Array };

export const DEFAULT_MAX_PNG_INPUT_BYTES = 32 * 1024 * 1024;
export const DEFAULT_MAX_PNG_PIXELS = 4096 * 4096;

interface NormalizedPngDecodeLimits {
  readonly maxInputBytes: number;
  readonly maxPixels: number;
}

interface PngHeader {
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
}

export interface SafeOutputPathOptions {
  readonly outputRoot: string;
  readonly requestedPath: string;
  readonly expectedExtension: ".png" | ".ts";
  readonly label: string;
}

export function toPngImageSource(source: { readonly imagePath?: string; readonly imageBuffer?: Uint8Array }): PngImageSource {
  const hasPath = source.imagePath !== undefined;
  const hasBuffer = source.imageBuffer !== undefined;

  if (hasPath === hasBuffer) {
    throw new Error("provide exactly one of imagePath or imageBuffer");
  }

  if (source.imagePath !== undefined) {
    return { imagePath: source.imagePath };
  }

  return { imageBuffer: source.imageBuffer as Uint8Array };
}

export async function readPngImage(source: PngImageSource, limits?: PngDecodeLimits): Promise<RgbaImage> {
  const normalizedLimits = normalizePngDecodeLimits(limits);
  const context = "imagePath" in source ? `PNG image at ${source.imagePath}` : "PNG image buffer";
  const bytes = await readPngBytes(source, normalizedLimits, context);
  const header = readPngHeader(bytes, context);
  assertPngPixelLimit(header, normalizedLimits, context);

  let png: PNG;
  try {
    png = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${context}: failed to decode PNG: ${message}`);
  }

  if (png.width !== header.width || png.height !== header.height) {
    throw new Error(
      `${context}: decoded dimensions ${png.width}x${png.height} do not match IHDR ${header.width}x${header.height}`
    );
  }

  return {
    width: png.width,
    height: png.height,
    data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength)
  };
}

export function resolveSafeOutputPath(options: SafeOutputPathOptions): string {
  const outputRoot = resolve(options.outputRoot);
  const requestedPath = options.requestedPath.trim();

  if (requestedPath.length === 0) {
    throw new Error(`${options.label} requires a non-empty output path`);
  }

  if (isAbsolute(requestedPath)) {
    throw new Error(`${options.label} must be relative to the output root`);
  }

  const resolvedPath = resolve(outputRoot, requestedPath);
  const relativePath = relative(outputRoot, resolvedPath);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`${options.label} escapes the output root`);
  }

  if (extname(resolvedPath).toLowerCase() !== options.expectedExtension) {
    throw new Error(`${options.label} must use the ${options.expectedExtension} extension`);
  }

  return resolvedPath;
}

export async function assertCanWriteOutputFile(outputPath: string, force: boolean, label: string): Promise<void> {
  if (force) {
    return;
  }

  try {
    await access(outputPath);
  } catch (error: unknown) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: could not check existing output file: ${message}`);
  }

  throw new Error(`${label} already exists; pass --force to overwrite: ${outputPath}`);
}

export async function writePngImage(outputPath: string, image: RgbaImage): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });

  const png = new PNG({ width: image.width, height: image.height });
  Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength).copy(png.data);
  await writeFile(outputPath, PNG.sync.write(png));
}

export function cloneRgbaImage(image: RgbaImage): RgbaImage {
  const data = new Uint8Array(image.data.length);
  data.set(image.data);

  return {
    width: image.width,
    height: image.height,
    data
  };
}

async function readPngBytes(
  source: PngImageSource,
  limits: NormalizedPngDecodeLimits,
  context: string
): Promise<Uint8Array> {
  if ("imagePath" in source) {
    const fileStat = await stat(source.imagePath);
    if (fileStat.size > limits.maxInputBytes) {
      throw new Error(`${context}: input size ${fileStat.size} bytes exceeds maxInputBytes ${limits.maxInputBytes}`);
    }

    return readFile(source.imagePath);
  }

  if (source.imageBuffer.byteLength > limits.maxInputBytes) {
    throw new Error(
      `${context}: input size ${source.imageBuffer.byteLength} bytes exceeds maxInputBytes ${limits.maxInputBytes}`
    );
  }

  return source.imageBuffer;
}

function normalizePngDecodeLimits(limits?: PngDecodeLimits): NormalizedPngDecodeLimits {
  return {
    maxInputBytes: assertPositiveSafeInteger(
      "maxInputBytes",
      limits?.maxInputBytes ?? DEFAULT_MAX_PNG_INPUT_BYTES
    ),
    maxPixels: assertPositiveSafeInteger("maxPixels", limits?.maxPixels ?? DEFAULT_MAX_PNG_PIXELS)
  };
}

function readPngHeader(bytes: Uint8Array, context: string): PngHeader {
  if (bytes.byteLength < 33) {
    throw new Error(`${context}: input is too small to contain a PNG IHDR header`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10] as const;
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) {
      throw new Error(`${context}: missing PNG signature`);
    }
  }

  const ihdrLength = view.getUint32(8, false);
  const ihdrType = String.fromCharCode(
    bytes[12] ?? 0,
    bytes[13] ?? 0,
    bytes[14] ?? 0,
    bytes[15] ?? 0
  );
  if (ihdrLength !== 13 || ihdrType !== "IHDR") {
    throw new Error(`${context}: missing PNG IHDR chunk`);
  }

  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (width === 0 || height === 0) {
    throw new Error(`${context}: PNG dimensions must be non-zero`);
  }

  if (height > Math.floor(Number.MAX_SAFE_INTEGER / width)) {
    throw new Error(`${context}: PNG dimensions ${width}x${height} exceed safe pixel arithmetic`);
  }

  return {
    width,
    height,
    pixelCount: width * height
  };
}

function assertPngPixelLimit(
  header: PngHeader,
  limits: NormalizedPngDecodeLimits,
  context: string
): void {
  if (header.pixelCount > limits.maxPixels) {
    throw new Error(
      `${context}: PNG dimensions ${header.width}x${header.height} (${header.pixelCount} pixels) exceed maxPixels ${limits.maxPixels}`
    );
  }
}

function assertPositiveSafeInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }

  return value;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === code
  );
}
