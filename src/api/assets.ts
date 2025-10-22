import { existsSync, mkdirSync } from "fs";

import type { ApiConfig } from "../config";
import path from "path";
import { BadRequestError } from "./errors";

export function ensureAssetsDir(cfg: ApiConfig) {
  if (!existsSync(cfg.assetsRoot)) {
    mkdirSync(cfg.assetsRoot, { recursive: true });
  }
}

export function mediaTypeToExt(mediaType: string) {
  const extensionMap: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
  };

  const extension = extensionMap[mediaType];

  if (!extension) {
    throw new BadRequestError(
      `Unsupported media type for thumbnail: ${mediaType}`
    );
  }

  return extension;
}

export function getAssetDiskPath(cfg: ApiConfig, assetPath: string) {
  return path.join(cfg.assetsRoot, assetPath);
}

export function getAssetURL(cfg: ApiConfig, assetPath: string) {
  return `http://localhost:${cfg.port}/assets/${assetPath}`;
}
