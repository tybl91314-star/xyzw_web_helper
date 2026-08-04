import test from "node:test";
import assert from "node:assert/strict";

import {
  MAIL_STATE_READ,
  claimMailAndMarkRead,
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
