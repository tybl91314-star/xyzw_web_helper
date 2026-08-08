export const MAIL_STATE_READ = 2;
export const MAIL_STATE_ATTACHMENT_GOT = 3;
// 实机协议验证：state 9 会删除邮件，并在重新读取邮箱后消失。
export const MAIL_STATE_DELETED = 9;
export const MAIL_CATEGORIES = [0, 4, 5];
export const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// 邮件 id 可能是 64 位整数，保留解码后的原始值，避免 Number 精度丢失。
const getMailId = (mail) => mail?.id ?? 0;

const normalizeTimestamp = (value) => {
  if (value == null || value === "") return 0;
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric < 1e12 ? numeric * 1000 : numeric;
};

/** 兼容不同版本邮件结构中的发送/创建时间字段。 */
export const getMailTimestamp = (mail) => {
  const candidates = [
    mail?.sendTime,
    mail?.sendAt,
    mail?.createTime,
    mail?.createdAt,
    mail?.createAt,
    mail?.mailTime,
    mail?.timestamp,
    mail?.time,
  ];
  for (const value of candidates) {
    const timestamp = normalizeTimestamp(value);
    if (timestamp) return timestamp;
  }
  return 0;
};

/**
 * 删除条件必须同时满足：已读、超过一周、没有待领取附件。
 * 无法识别时间的邮件宁可保留，避免误删。
 */
export const canDeleteReadMail = (mail, now = Date.now()) => {
  const state = Number(mail?.state || 0);
  const timestamp = getMailTimestamp(mail);
  const hasUnclaimedAttachment =
    Boolean(mail?.haveAttachments) && state < MAIL_STATE_ATTACHMENT_GOT;

  return (
    (state === MAIL_STATE_READ || state === MAIL_STATE_ATTACHMENT_GOT) &&
    !hasUnclaimedAttachment &&
    timestamp > 0 &&
    now - timestamp >= ONE_WEEK_MS
  );
};

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

/**
 * 删除一周以上的已读邮件。
 * 未领取附件、时间不明、未读或不足一周的邮件一律保留。
 */
export const deleteOldReadMails = async (send, now = Date.now()) => {
  const mails = await fetchAllMails(send);
  let protectedAttachmentCount = 0;
  let skippedUnknownTimeCount = 0;
  const eligibleMails = [];

  for (const mail of mails) {
    const state = Number(mail?.state || 0);
    if (state !== MAIL_STATE_READ && state !== MAIL_STATE_ATTACHMENT_GOT) continue;

    if (mail?.haveAttachments && state < MAIL_STATE_ATTACHMENT_GOT) {
      protectedAttachmentCount += 1;
      continue;
    }
    if (!getMailTimestamp(mail)) {
      skippedUnknownTimeCount += 1;
      continue;
    }
    if (!canDeleteReadMail(mail, now)) continue;
    eligibleMails.push(mail);
  }

  const failedMails = [];
  for (const mail of eligibleMails) {
    const mailId = getMailId(mail);
    try {
      await send("mail_changestate", {
        mailId,
        state: MAIL_STATE_DELETED,
      });
    } catch (error) {
      failedMails.push({
        mailId,
        error: error?.message || "未知错误",
      });
    }
  }

  const refreshedMails = eligibleMails.length
    ? await fetchAllMails(send)
    : mails;
  const remainingIds = new Set(
    refreshedMails.map((mail) => String(getMailId(mail))),
  );
  const deletedCount = eligibleMails.filter(
    (mail) => !remainingIds.has(String(getMailId(mail))),
  ).length;

  return {
    mailCount: mails.length,
    eligibleCount: eligibleMails.length,
    deletedCount,
    failedCount: failedMails.length,
    failedMails,
    protectedAttachmentCount,
    skippedUnknownTimeCount,
  };
};
