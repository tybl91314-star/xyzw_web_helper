import test from "node:test";
import assert from "node:assert/strict";

import { getEquipmentQuenchStats } from "../src/utils/equipmentQuenchStats.js";

test("孔数统计全部有效孔位，红数只统计红色孔位", () => {
  const stats = getEquipmentQuenchStats({
    weapon: {
      quenches: {
        1: { colorId: 6 },
        2: { colorId: 5 },
        3: { colorId: 3 },
        // 实际数据中白色孔可能没有可用的颜色/属性字段，
        // 但只要它存在于 quenches 就是已开启的孔。
        4: { colorId: 0, attrId: 0, attrNum: 0 },
        5: null,
      },
    },
    armor: { quenches: { 1: { colorId: "6" } } },
    mount: { quenches: { 1: { colorId: 0, attrId: 101, attrNum: 5 } } },
  });

  assert.deepEqual(stats, { redCount: 2, holeCount: 6 });
});

test("缺少装备或孔位数据时返回零且不会抛错", () => {
  assert.deepEqual(getEquipmentQuenchStats(null), {
    redCount: 0,
    holeCount: 0,
  });
  assert.deepEqual(getEquipmentQuenchStats({ weapon: {} }), {
    redCount: 0,
    holeCount: 0,
  });
});
