import type { DecodedPointCloud, EncodedPointCloud } from "./types";

type Base64Function = (value: string) => string;

export const MAX_POINT_CLOUD_POINTS = 10_000_000;
export const MAX_DECODED_POINT_CLOUD_BYTES = 256 * 1024 * 1024;

export function encodeFloat32Base64(values: Float32Array): string {
  const bytes = new Uint8Array(values.length * Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer);

  for (let index = 0; index < values.length; index += 1) {
    view.setFloat32(index * Float32Array.BYTES_PER_ELEMENT, values[index] ?? 0, true);
  }

  return encodeBytesBase64(bytes);
}

export function decodeFloat32Base64(value: string, expectedLength?: number): Float32Array {
  const expectedByteLength = expectedLength === undefined
    ? undefined
    : checkedByteLength("positions", expectedLength, Float32Array.BYTES_PER_ELEMENT);
  const bytes = decodeBase64ToBytes(value, {
    label: "positions",
    ...(expectedByteLength !== undefined ? { expectedByteLength } : {})
  });
  if (bytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error("positions payload length must be divisible by 4");
  }

  const result = new Float32Array(bytes.byteLength / Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = view.getFloat32(index * Float32Array.BYTES_PER_ELEMENT, true);
  }

  if (expectedLength !== undefined && result.length !== expectedLength) {
    throw new Error(`positions payload has ${result.length} values, expected ${expectedLength}`);
  }

  return result;
}

export function encodeUint8Base64(values: Uint8Array): string {
  return encodeBytesBase64(values);
}

export function decodeUint8Base64(value: string, expectedLength?: number, label = "u8"): Uint8Array {
  const bytes = decodeBase64ToBytes(value, {
    label,
    ...(expectedLength !== undefined ? { expectedByteLength: checkedValueCount(label, expectedLength) } : {})
  });
  const result = new Uint8Array(bytes.byteLength);
  result.set(bytes);

  if (expectedLength !== undefined && result.length !== expectedLength) {
    throw new Error(`${label} payload has ${result.length} values, expected ${expectedLength}`);
  }

  return result;
}

export function decodePointCloud(encoded: EncodedPointCloud): DecodedPointCloud {
  if (encoded.schemaVersion !== 1) {
    throw new Error(`unsupported point cloud schemaVersion: ${encoded.schemaVersion}`);
  }

  if (encoded.encoding.positions !== "base64:f32le" || encoded.encoding.colors !== "base64:u8") {
    throw new Error("unsupported point cloud encoding");
  }

  const pointCount = validatePointCount(encoded.pointCount);
  validateEncodedMetadata(encoded, pointCount);

  const expectedPositionsLength = checkedValueCount("positions", pointCount * 3);
  const expectedColorsLength = checkedValueCount("colors", pointCount * 3);
  const hasSizesPayload = encoded.sizes !== undefined;
  const totalExpectedBytes =
    checkedByteLength("positions", expectedPositionsLength, Float32Array.BYTES_PER_ELEMENT) +
    checkedValueCount("colors", expectedColorsLength) +
    (hasSizesPayload ? checkedValueCount("sizes", pointCount) : 0);

  if (totalExpectedBytes > MAX_DECODED_POINT_CLOUD_BYTES) {
    throw new Error(
      `point cloud payload would decode ${totalExpectedBytes} bytes, exceeding limit ${MAX_DECODED_POINT_CLOUD_BYTES}`
    );
  }

  const positions = decodeFloat32Base64(encoded.positions, expectedPositionsLength);
  const colors = decodeUint8Base64(encoded.colors, expectedColorsLength, "colors");
  const base = {
    pointCount,
    dims: encoded.dims,
    positions,
    colors,
    stats: encoded.stats
  };

  if (encoded.sizes !== undefined) {
    return {
      ...base,
      sizes: decodeUint8Base64(encoded.sizes, pointCount, "sizes")
    };
  }

  return base;
}

interface Base64DecodeOptions {
  readonly label: string;
  readonly expectedByteLength?: number;
}

function decodeBase64ToBytes(value: string, options: Base64DecodeOptions): Uint8Array {
  assertCanonicalBase64Text(value, options.label);
  const decodedByteLength = getDecodedBase64ByteLength(value);

  if (options.expectedByteLength !== undefined && decodedByteLength !== options.expectedByteLength) {
    throw new Error(
      `${options.label} payload decodes to ${decodedByteLength} bytes, expected ${options.expectedByteLength}`
    );
  }

  if (decodedByteLength > MAX_DECODED_POINT_CLOUD_BYTES) {
    throw new Error(
      `${options.label} payload decodes to ${decodedByteLength} bytes, exceeding limit ${MAX_DECODED_POINT_CLOUD_BYTES}`
    );
  }

  const binary = decodeBase64String(value, options.label);
  if (binary.length !== decodedByteLength) {
    throw new Error(`${options.label} payload decoded length mismatch`);
  }

  const bytes = new Uint8Array(decodedByteLength);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  if (encodeBytesBase64(bytes) !== value) {
    throw new Error(`${options.label} payload must be canonical base64`);
  }

  return bytes;
}

function assertCanonicalBase64Text(value: string, label: string): void {
  if (value.length === 0) {
    return;
  }

  if (value.length % 4 !== 0) {
    throw new Error(`${label} payload base64 length must be a multiple of 4`);
  }

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error(`${label} payload must be canonical base64 without whitespace or base64url characters`);
  }

  const firstPadding = value.indexOf("=");
  if (firstPadding !== -1 && firstPadding < value.length - getBase64PaddingLength(value)) {
    throw new Error(`${label} payload base64 padding must appear only at the end`);
  }
}

function getDecodedBase64ByteLength(value: string): number {
  if (value.length === 0) {
    return 0;
  }

  return (value.length / 4) * 3 - getBase64PaddingLength(value);
}

function getBase64PaddingLength(value: string): number {
  if (value.endsWith("==")) {
    return 2;
  }

  if (value.endsWith("=")) {
    return 1;
  }

  return 0;
}

function decodeBase64String(value: string, label: string): string {
  const decoder = getBase64Global("atob");
  try {
    return decoder(value);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} payload is invalid base64: ${message}`);
  }
}

function encodeBytesBase64(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) {
    return "";
  }

  const encoder = getBase64Global("btoa");
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
    const chunk = bytes.subarray(offset, Math.min(offset + 0x8000, bytes.byteLength));
    let chunkText = "";
    for (let index = 0; index < chunk.length; index += 1) {
      chunkText += String.fromCharCode(chunk[index] ?? 0);
    }
    binary += chunkText;
  }

  return encoder(binary);
}

function getBase64Global(name: "atob" | "btoa"): Base64Function {
  const globals = globalThis as typeof globalThis & {
    readonly atob?: Base64Function;
    readonly btoa?: Base64Function;
  };
  const fn = globals[name];
  if (typeof fn !== "function") {
    throw new Error(`global ${name} is required for base64 point-cloud payloads`);
  }

  return fn.bind(globalThis);
}

function validatePointCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_POINT_CLOUD_POINTS) {
    throw new Error(`pointCount must be a safe non-negative integer <= ${MAX_POINT_CLOUD_POINTS}`);
  }

  return value;
}

function validateEncodedMetadata(encoded: EncodedPointCloud, pointCount: number): void {
  if (encoded.stats.pointCount !== pointCount) {
    throw new Error(`stats.pointCount ${encoded.stats.pointCount} does not match pointCount ${pointCount}`);
  }

  if (encoded.stats.dims.width !== encoded.dims.width || encoded.stats.dims.height !== encoded.dims.height) {
    throw new Error("stats.dims does not match encoded dims");
  }

  if (encoded.stats.sampleStep !== encoded.sampleStep) {
    throw new Error("stats.sampleStep does not match encoded sampleStep");
  }

  const hasSizesPayload = encoded.sizes !== undefined;
  const hasSizesEncoding = encoded.encoding.sizes !== undefined;
  if (hasSizesPayload !== hasSizesEncoding) {
    throw new Error("sizes payload and encoding metadata must be present together");
  }

  if (hasSizesPayload && encoded.encoding.sizes !== "base64:u8") {
    throw new Error("sizes payload exists without base64:u8 encoding");
  }

  if (encoded.stats.optionsSummary.includeSizes !== hasSizesPayload) {
    throw new Error("sizes payload does not match stats.optionsSummary.includeSizes");
  }
}

function checkedValueCount(label: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} expected length must be a safe non-negative integer`);
  }

  return value;
}

function checkedByteLength(label: string, valueCount: number, bytesPerValue: number): number {
  const checkedCount = checkedValueCount(label, valueCount);
  if (checkedCount > Math.floor(Number.MAX_SAFE_INTEGER / bytesPerValue)) {
    throw new Error(`${label} payload byte length exceeds safe integer bounds`);
  }

  return checkedCount * bytesPerValue;
}
