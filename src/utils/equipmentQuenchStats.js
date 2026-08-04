/**
 * 统计装备已开启的淬炼孔位和其中的红色孔位。
 * 空装备、空孔位或不完整的查询结果不会中断整套阵容统计。
 */
export const getEquipmentQuenchStats = (equipment) => {
  let holeCount = 0;
  let redCount = 0;

  Object.values(equipment || {}).forEach((equipmentPart) => {
    Object.values(equipmentPart?.quenches || {}).forEach((slot) => {
      if (!slot || typeof slot !== "object") return;

      // 服务端只会把已开启的孔位放进 quenches；尚未开启的
      // 第 5 孔不会出现。因此每个孔位对象都要计入开孔数，不能再用
      // colorId/attrId 判断，否则白色等非红属性会被漏算。
      const colorId = Number(slot.colorId || 0);
      holeCount += 1;
      if (colorId === 6) redCount += 1;
    });
  });

  return { redCount, holeCount };
};
