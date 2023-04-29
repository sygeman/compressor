import { execSync } from "child_process";

export const getFramesData = (path) => {
  const framesDataRow = execSync(
    `ffprobe -v error -select_streams v:0 -count_packets -show_entries stream=nb_read_packets -of csv=p=0 ${path}`
  )
    .toString()
    .trim();

  const allFrames = parseInt(framesDataRow, 10);
  return allFrames;
};
