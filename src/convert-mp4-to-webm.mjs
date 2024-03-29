import { spawn } from "node:child_process";
import { getFramesData } from "./frames-data.mjs";

export const convertMp4ToWebm = async ({
  inputFile,
  outputFile,
  onProgress,
}) => {
  const allFrames = getFramesData(inputFile);
  const s1 = performance.now();

  const output = (data) => {
    let str = data
      .toString()
      .split(/(\r\n|\n)+/)
      .filter((i) => i.trim().length);

    console.log(performance.now() - s1);

    str.forEach((row) => {
      if (typeof row === "string" && row.includes("frame=")) {
        const currentFrame = parseInt(row.slice(6), 10);
        const percent = (currentFrame / allFrames) * 100;
        onProgress(percent);
      }
    });
  };

  let proc = spawn(
    "ffmpeg",
    [
      "-y",
      "-i",
      inputFile,
      "-c:v libvpx-vp9",
      "-crf 40",
      "-deadline realtime",
      "-cpu-used -6",
      "-progress pipe:1",
      outputFile,
    ],
    { shell: true, env: { ...process.env } }
  );

  await new Promise((resolve, reject) => {
    proc.stdout.on("data", output);

    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (err) => console.log(err));

    proc.on("exit", (code) => {
      if (code === 0) return resolve(true);
      reject(code);
    });
  });
};
