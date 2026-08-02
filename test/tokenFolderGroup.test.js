import test from "node:test";
import assert from "node:assert/strict";
import { getNearestParentFolderName } from "../src/utils/tokenFolderGroup.js";

test("uses selected root folder for files directly inside it", () => {
  assert.equal(getNearestParentFolderName("主账号/bin-a.bin"), "主账号");
});

test("uses the nearest parent for deeply nested BIN files", () => {
  assert.equal(
    getNearestParentFolderName("咸鱼之王/一队/日常/bin-a.bin"),
    "日常",
  );
});

test("supports Android and Windows-style separators", () => {
  assert.equal(getNearestParentFolderName("总目录\\二队\\bin-a.bin"), "二队");
});

test("does not create a group for an individually selected file", () => {
  assert.equal(getNearestParentFolderName("bin-a.bin"), "");
});
