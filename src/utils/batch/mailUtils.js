export const MAIL_STATE_READ = 2;
export const MAIL_STATE_ATTACHMENT_GOT = 3;
export const MAIL_CATEGORIES = [0, 4, 5];

// 邮件 id 可能是 64 位整数，保留解码后的原始值，避免 Number 精度丢失。
const getMailId = (mail) => mail?.id ?? 0;

/**
 * 分页获取系统、日常和公告邮件，并按 id 去重。
 */
export const fetchAllMails = async (send, pageSize = 60) => {
  const mails = [];
  const seenIds = new Set();
  let lastId = 0;

  // 正常邮箱数量远低于 1200；上限用于防止异常响应导致死循环。
  for (let page = 0; page < 20; page += 1) {
    const response = await send("mail_getlist", {
      category: MAIL_CATEGORIES,
      lastId,
      size: pageSize,
    });
    const list = Array.isArray(response?.list) ? response.list : [];

    list.forEach((mail) => {
      const id = getMailId(mail);
      const idKey = String(id);
      if (!id || seenIds.has(idKey)) return;
      seenIds.add(idKey);
      mails.push(mail);
    });

    if (list.length < pageSize) break;
    const nextLastId = getMailId(list.at(-1));
    if (!nextLastId || nextLastId === lastId) break;
    lastId = nextLastId;
  }

  return mails;
};

/**
 * 领取邮件附件后将所有无待领附件的邮件设为已读。
 * 仍有未领附件的邮件会被跳过，避免奖励未领却被标记已读。
 */
export const claimMailAndMarkRead = async (send) => {
  const beforeClaim = await fetchAllMails(send);
  const attachmentCategories = [
    ...new Set(
      beforeClaim
        .filter(
          (mail) =>
            mail?.haveAttachments &&
            Number(mail?.state || 0) < MAIL_STATE_ATTACHMENT_GOT,
        )
        .map((mail) => Number(mail.category))
        .filter((category) => MAIL_CATEGORIES.includes(category)),
    ),
  ];

  for (const category of attachmentCategories) {
    await send("mail_claimallattachment", { category });
  }

  const afterClaim = await fetchAllMails(send);
  let readCount = 0;
  let skippedAttachmentCount = 0;

  for (const mail of afterClaim) {
    const state = Number(mail?.state || 0);
    if (state >= MAIL_STATE_READ) continue;

    if (mail?.haveAttachments && state < MAIL_STATE_ATTACHMENT_GOT) {
      skippedAttachmentCount += 1;
      continue;
    }

    await send("mail_changestate", {
      mailId: getMailId(mail),
      state: MAIL_STATE_READ,
    });
    readCount += 1;
  }

  return {
    claimedCategoryCount: attachmentCategories.length,
    mailCount: afterClaim.length,
    readCount,
    skippedAttachmentCount,
  };
};
