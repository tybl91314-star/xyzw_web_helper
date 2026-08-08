import test from "node:test";
import assert from "node:assert/strict";

import {
  MAIL_STATE_ATTACHMENT_GOT,
  MAIL_STATE_DELETED,
  MAIL_STATE_READ,
  canDeleteReadMail,
  claimMailAndMarkRead,
  deleteOldReadMails,
} from "../src/utils/batch/mailUtils.js";

test("邮件附件先领取，无附件未读邮件再全部设为已读", async () => {
  const calls = [];
  let getListCount = 0;
  const send = async (cmd, params) => {
    calls.push({ cmd, params });
    if (cmd !== "mail_getlist") return {};

    getListCount += 1;
    if (getListCount === 1) {
      return {
        list: [
          { id: 11, category: 0, state: 0, haveAttachments: true },
          { id: 12, category: 4, state: 0, haveAttachments: false },
        ],
      };
    }
    return {
      list: [
        { id: 11, category: 0, state: 3, haveAttachments: true },
        { id: 12, category: 4, state: 0, haveAttachments: false },
        { id: 13, category: 5, state: 1, haveAttachments: false },
      ],
    };
  };

  const result = await claimMailAndMarkRead(send);

  assert.deepEqual(result, {
    claimedCategoryCount: 1,
    mailCount: 3,
    readCount: 2,
    skippedAttachmentCount: 0,
  });
  assert.deepEqual(
    calls.filter(({ cmd }) => cmd === "mail_changestate"),
    [
      { cmd: "mail_changestate", params: { mailId: 12, state: MAIL_STATE_READ } },
      { cmd: "mail_changestate", params: { mailId: 13, state: MAIL_STATE_READ } },
    ],
  );
  assert.ok(
    calls.findIndex(({ cmd }) => cmd === "mail_claimallattachment") <
      calls.findIndex(({ cmd }) => cmd === "mail_changestate"),
  );
});

test("附件领取后仍未领取的邮件不标记已读", async () => {
  let getListCount = 0;
  const changedIds = [];
  const send = async (cmd, params) => {
    if (cmd === "mail_getlist") {
      getListCount += 1;
      return {
        list: [{ id: 21, category: 0, state: 0, haveAttachments: true }],
      };
    }
    if (cmd === "mail_changestate") changedIds.push(params.mailId);
    return {};
  };

  const result = await claimMailAndMarkRead(send);
  assert.equal(getListCount, 2);
  assert.equal(result.skippedAttachmentCount, 1);
  assert.deepEqual(changedIds, []);
});

test("使用已验证的 state 9 删除全部安全旧邮件，并重新读取确认", async () => {
  const now = Date.UTC(2026, 7, 8, 12);
  const changed = [];
  let mails = [
    { id: 31, state: MAIL_STATE_READ, haveAttachments: false, sendTime: now / 1000 - 8 * 86400 },
    { id: 32, state: MAIL_STATE_READ, haveAttachments: true, sendTime: now / 1000 - 20 * 86400 },
    { id: 33, state: MAIL_STATE_ATTACHMENT_GOT, haveAttachments: true, createTime: now - 9 * 86400000 },
    { id: 34, state: MAIL_STATE_READ, haveAttachments: false, sendAt: now - 6 * 86400000 },
    { id: 35, state: MAIL_STATE_READ, haveAttachments: false },
    { id: 36, state: 0, haveAttachments: false, sendTime: now / 1000 - 30 * 86400 },
  ];
  const send = async (cmd, params) => {
    if (cmd === "mail_getlist") {
      return { list: mails };
    }
    changed.push(params);
    assert.equal(params.state, MAIL_STATE_DELETED);
    mails = mails.filter((mail) => mail.id !== params.mailId);
    return {};
  };

  const result = await deleteOldReadMails(send, now);

  assert.deepEqual(changed, [
    { mailId: 31, state: MAIL_STATE_DELETED },
    { mailId: 33, state: MAIL_STATE_DELETED },
  ]);
  assert.equal(result.deletedCount, 2);
  assert.equal(result.eligibleCount, 2);
  assert.equal(result.failedCount, 0);
  assert.equal(result.protectedAttachmentCount, 1);
  assert.equal(result.skippedUnknownTimeCount, 1);
  assert.equal(canDeleteReadMail(mails[1], now), false);
});
