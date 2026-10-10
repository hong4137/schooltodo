// 빌드 후 dist/sw.js 의 CACHE_NAME 자리표시자(__BUILD__)를 빌드 시각으로 바꾼다.
// → 배포마다 캐시 이름이 달라져서 예전처럼 손으로 v2→v3 올릴 필요가 없다.
import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../dist/sw.js", import.meta.url);
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12); // YYYYMMDDHHMM
let src = readFileSync(path, "utf8");
if (!src.includes("__BUILD__")) {
  console.warn("stamp-sw: __BUILD__ 자리표시자가 없음 (이미 치환됐거나 sw.js 가 바뀜)");
} else {
  src = src.replace("__BUILD__", stamp);
  writeFileSync(path, src);
  console.log(`stamp-sw: CACHE_NAME = schooltodo-${stamp}`);
}
