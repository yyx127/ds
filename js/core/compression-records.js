/**
 * ============================================================
 * compression-records.js —— 按"分支"保存的压缩记录（不改动原始消息）
 * ============================================================
 * 【本次修正：从"按对话存"改成"按分支存"】
 * 旧版本压缩记录直接用 conversationId 当 key，整个对话共用一份。
 * 问题：角色扮演场景里用户经常切换分支回看旧版本剧情，一切换分支就要
 * 把这份记录整体清空重新压缩——明明别的分支早就压缩过、摘要还有效，
 * 却被当成"过期"强制作废，白白浪费一次真实的 API 调用。
 *
 * 现在改成按"当前可见路径的最后一条消息 id"存（叫 leafId）。
 * 原理：一条可见路径 = 从根节点沿着每个节点的 selectedChildId 走到底，
 * 这条路径完全由"走到的最后一个节点是谁"唯一确定——只要叶子节点 id
 * 相同，说明整条路径（包括中间所有分支选择）完全一样，之前算出来的摘要
 * 依然对应得上，可以继续用；一旦用户切换到别的分支，叶子 id 必然不同，
 * 自动就读不到这份记录了，根本不需要手动调用"失效"逻辑去清空它——
 * 每个分支的压缩记录天然互不干扰，各自独立保留。
 *
 * 和原始消息的关系依然不变：压缩只产生这份记录，不触碰 conversationTrees
 * 本身——原始消息树永远完整，页面上的每一条气泡永远对应一条真实存在的消息，
 * 编辑/重新生成永远能找到目标。真正"省 token"的效果，发生在
 * js/modules/chat/chat.js 的 buildApiMessages 组装发给模型的请求体这一步。
 *
 * 压缩记录只保存在内存里（随页面刷新丢失）——这是有意的简化：压缩记录
 * 本身是一个"派生结果"（随时可以从原始消息重新生成一份新的），不需要
 * 占用 IndexedDB 空间持久化它；刷新后自动压缩钩子会在下次接近阈值时
 * 针对当前分支自然重新生成。
 * ============================================================
 */

(function () {
  "use strict";

  // recordKey（conversationId + "::" + leafId） -> { shadowedMessageIds, summary, createdAt }
  var records = {};

  function buildKey(conversationId, leafId) {
    return conversationId + "::" + (leafId || "(empty)");
  }

  /**
   * 保存（覆盖）指定对话、指定分支（由 leafId 标识）的压缩记录。
   * @param {string} conversationId
   * @param {string} leafId 当前可见路径最后一条消息的 id（没有消息时传 null/空）
   * @param {Object} record { shadowedMessageIds, summary }
   */
  function setRecord(conversationId, leafId, record) {
    records[buildKey(conversationId, leafId)] = {
      shadowedMessageIds: record.shadowedMessageIds || [],
      summary: record.summary || "",
      createdAt: Date.now()
    };
  }

  /**
   * 读取指定对话、指定分支当前生效的压缩记录，不存在时返回 null。
   * @param {string} conversationId
   * @param {string} leafId
   * @returns {Object|null}
   */
  function getRecord(conversationId, leafId) {
    return records[buildKey(conversationId, leafId)] || null;
  }

  /**
   * 清除指定对话、指定分支的压缩记录（例如用户编辑/重新生成了被压缩覆盖范围内
   * 的某条消息，原来的摘要已经不能准确代表新的历史结构，必须作废）。
   * 注意：这不再在"切换分支"时被调用——切分支只是换了 leafId，天然去读另一个
   * key，不需要清空任何东西；只有"编辑/重新生成改变了当前这条分支本身的结构"
   * 时才需要调用本函数。
   * @param {string} conversationId
   * @param {string} leafId
   */
  function clearRecord(conversationId, leafId) {
    delete records[buildKey(conversationId, leafId)];
  }

  /**
   * 清除某个对话名下的全部分支压缩记录（对话被清空/删除时整体清理，
   * 避免 records 里累积一堆再也用不到的 key 造成内存泄漏）。
   * @param {string} conversationId
   */
  function clearAllRecordsForConversation(conversationId) {
    var prefix = conversationId + "::";
    Object.keys(records).forEach(function (key) {
      if (key.indexOf(prefix) === 0) {
        delete records[key];
      }
    });
  }

  window.DSCompressionRecords = {
    setRecord: setRecord,
    getRecord: getRecord,
    clearRecord: clearRecord,
    clearAllRecordsForConversation: clearAllRecordsForConversation
  };
})();
