import { respondWithJSON } from "./json";
import { type ApiConfig } from "../config";
import { S3Client, type BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import { getAssetDiskPath, getAssetPath, getAssetURL } from "./assets";
import { uploadVideoToS3 } from "../s3";
import path from "path";
import { rm } from "fs/promises";

const MAX_UPLOAD_SIZE = 1 << 30;

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading video", videoId, "by user", userID);

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Video not found");
  }
  if (video.userID !== userID) {
    throw new UserForbiddenError(
      "You don't have permission to upload this video"
    );
  }

  const formData = await req.formData();
  const file = formData.get("video");
  if (!(file instanceof File)) {
    throw new BadRequestError("Video file missing");
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError(
      `File too large. Maximum size is ${MAX_UPLOAD_SIZE / (1024 * 1024)}MB`
    );
  }

  if (file.type !== "video/mp4") {
    throw new BadRequestError("Only MP4 video files are supported");
  }

  const tempFilePath = path.join("/tmp", `${videoId}.mp4`);
  await Bun.write(tempFilePath, file);

  const aspectRatio = await getVideoAspectRatio(tempFilePath);

  let key = `${aspectRatio}/${videoId}.mp4`;
  await uploadVideoToS3(cfg, key, tempFilePath, "video/mp4");

  const videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${key}`;
  video.videoURL = videoURL;
  updateVideo(cfg.db, video);

  await Promise.all([rm(tempFilePath, { force: true })]);

  return respondWithJSON(200, video);
}

export async function getVideoAspectRatio(filePath: string) {
  const proc = Bun.spawn({
    cmd: [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      filePath,
    ],
    stdout: "pipe",
    stderr: "pipe",
  });

  const output: string = await new Response(proc.stdout).text();
  const errors: string = await new Response(proc.stderr).text();

  const exitCode = await proc.exited;
  if (exitCode != 0) {
    throw new Error(`ffprobe error: ${errors}`);
  }

  const parsedOutput = JSON.parse(output);
  if (!parsedOutput.streams || parsedOutput.streams.length === 0) {
    throw new Error("No streams were found");
  }

  const { width, height } = parsedOutput.streams[0];

  return width === Math.floor(16 * (height / 9))
    ? "landscape"
    : height === Math.floor(16 * (width / 9))
    ? "portrait"
    : "other";
}
