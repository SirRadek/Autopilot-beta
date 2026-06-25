import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { decodePointCloud, imageToPointCloud } from "../../src/lib/image-point-cloud";
import { encodeFloat32Base64, encodeUint8Base64 } from "../../src/lib/image-point-cloud/pack";

const fixturePath = resolve("tests/fixtures/image-point-cloud/faithful-sampling-fixture.png");

describe("imageToPointCloud", () => {
  it("is deterministic for the same input and seed", async () => {
    const options = {
      imagePath: fixturePath,
      sampleStep: 1,
      alphaThreshold: 10,
      brightnessFloor: 0.05,
      depthAmp: 2,
      targetCount: 7,
      seed: "stable-seed"
    };

    const first = await imageToPointCloud(options);
    const second = await imageToPointCloud(options);

    expect(second).toEqual(first);
  });

  it("excludes transparent and below-floor background pixels", async () => {
    const pointCloud = await imageToPointCloud({
      imagePath: fixturePath,
      sampleStep: 1,
      alphaThreshold: 10,
      brightnessFloor: 0.05
    });

    expect(pointCloud.pointCount).toBe(16);
    expect(pointCloud.stats.sampledPixelCount).toBe(48);
    expect(pointCloud.stats.maskedPixelCount).toBe(32);
    expect(pointCloud.stats.maskedRatio).toBeCloseTo(32 / 48);

    const decoded = decodePointCloud(pointCloud);
    for (let index = 0; index < decoded.pointCount; index += 1) {
      const red = decoded.colors[index * 3] ?? 0;
      const green = decoded.colors[index * 3 + 1] ?? 0;
      const blue = decoded.colors[index * 3 + 2] ?? 0;
      expect(red + green + blue).toBeGreaterThan(0);
    }
  });

  it("round-trips base64 payloads into typed arrays", async () => {
    const pointCloud = await imageToPointCloud({
      imagePath: fixturePath,
      sampleStep: 1,
      alphaThreshold: 10,
      brightnessFloor: 0.05
    });

    const decoded = decodePointCloud(pointCloud);

    expect(decoded.pointCount).toBe(pointCloud.pointCount);
    expect(decoded.positions).toHaveLength(pointCloud.pointCount * 3);
    expect(decoded.colors).toHaveLength(pointCloud.pointCount * 3);
    expect(encodeFloat32Base64(decoded.positions)).toBe(pointCloud.positions);
    expect(encodeUint8Base64(decoded.colors)).toBe(pointCloud.colors);
    expect(decoded.stats).toEqual(pointCloud.stats);
  });

  it("keeps the point count in the expected range for the fixture", async () => {
    const pointCloud = await imageToPointCloud({
      imagePath: fixturePath,
      sampleStep: 2,
      alphaThreshold: 10,
      brightnessFloor: 0.05
    });

    expect(pointCloud.pointCount).toBeGreaterThanOrEqual(4);
    expect(pointCloud.pointCount).toBeLessThanOrEqual(4);
  });
});
