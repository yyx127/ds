/**
 * ============================================================
 * conversation-store.js —— 对话与消息的真实本地持久化（核心基础设施）
 * ============================================================
 * 职责：
 *   把 sidebar.js 的对话列表（标题/置顶/预览/更新时间等元数据）与
 *   chat.js 的每个对话的完整消息数组，作为同一份数据整体存入 IndexedDB，
 *   刷新页面后可以完整恢复——这是此前版本里明确标注"留给后续 Step"、
 *   一直没有实现的缺口，本文件正式把它补上。
 *
 * 存储粒度的选择：
 *   把"对话列表 + 每个对话的消息"存成一条记录（一个 JSON 对象），而不是
 *   每个对话单独一条记录。对于个人本地聊天工具的数据量级（通常几十到
 *   几百个对话，每个对话几十到几百条消息），整体读写一次的开销完全可以
 *   接受，换来的好处是"保存"永远是一次原子写入，不会出现"对话列表更新了
 *   但某条对话的消息还没来得及单独写入"这种半成功的中间状态。
 *
 * 写入时机与节流：
 *   - 发送/接收消息、重命名、置顶、删除等任何会改变数据的操作之后，
 *     由 sidebar.js / chat.js 调用 window.DSConversationStore.scheduleSave()
 *   - scheduleSave 内部做 400ms 防抖：流式回复逐字追加内容时不会每个字符
 *     都写一次库（那样既浪费性能也没必要），而是停止变化 400ms 后才真正落盘；
 *     但停止生成、切换会话、关闭页面前这些"必须立刻保存"的时机，
 *     会调用 saveNow() 跳过防抖直接写入
 *
 * 加载时机：
 *   main.js 在最早期调用一次 window.DSConversationStore.load()，
 *   取到的数据交给 sidebar.js 初始化对话列表（取不到或 IndexedDB 不可用时，
 *   由 sidebar.js 自己回退到 mock-data.js 的演示数据，保证应用在任何环境下
 *   都能正常打开，不会因为存储层异常而白屏）。
 * ============================================================
 */

(function () {
  "use strict";

  var STORAGE_KEY = "conversation_store__v1";
  var SAVE_DEBOUNCE_MS = 400;

  var saveTimer = null;
  // 标记是否有一次 saveNow 因为正在进行中的写入而被跳过、需要在当前写入完成后补一次，
  // 避免"连续两次 saveNow 几乎同时调用"时丢失最后一次的数据变化
  var pendingResave = false;
  var isSaving = false;

  /**
   * 从 IndexedDB 读取完整的对话数据。
   * @returns {Promise<Array|null>} 对话数组（结构与 sidebar.js 的 conversations 一致，
   *   每个对话对象上额外挂一个 messages 字段），取不到或出错时 resolve(null)，
   *   由调用方（sidebar.js）决定是否回退到假数据
   */
  function load() {
    if (!window.DSDb) {
      console.warn("[DSConversationStore] 未检测到 window.DSDb，跳过加载，将使用演示数据启动。");
      return Promise.resolve(null);
    }
    return window.DSDb
      .get(STORAGE_KEY)
      .then(function (record) {
        if (!record || !Array.isArray(record.conversations)) {
          return null;
        }
        return record.conversations;
      })
      .catch(function (err) {
        // 边界处理：IndexedDB 读取失败（隐私模式/数据损坏等）时不阻断应用启动，
        // 退化为 null，让调用方用演示数据顶上，用户仍然能正常使用，只是看不到历史记录
        console.warn("[DSConversationStore] 读取本地对话数据失败，将使用演示数据启动：", err);
        return null;
      });
  }

  /**
   * 立即保存（跳过防抖），供"必须马上落盘"的场景调用：
   * 停止生成、切换会话前、清空/删除操作完成后、页面即将卸载前。
   * @param {Array} conversations 完整对话数组（sidebar.js 的 conversations，
   *   每个对话对象需要自带 messages 字段——由 chat.js 提供的
   *   getMessagesForPersist() 在调用前同步挂好）
   * @returns {Promise<void>}
   */
  function saveNow(conversations) {
    if (!window.DSDb) {
      return Promise.resolve();
    }
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (isSaving) {
      // 上一次写入还没完成：记个标记，这次的数据变化稍后会在当前写入完成后被捕获到
      // （调用方每次都是传入"当前最新的完整数据"，不存在丢失增量的问题，只是写入顺序延后）
      pendingResave = true;
      return Promise.resolve();
    }
    isSaving = true;
    return window.DSDb
      .put(STORAGE_KEY, { conversations: conversations, savedAt: Date.now() })
      .catch(function (err) {
        // 边界处理：写入失败（容量超限、隐私模式等）只记录日志，不阻断聊天主流程，
        // 不重复弹 Toast 打扰用户——保存失败对用户来说是"下次刷新可能丢失这次对话"，
        // 不是"现在这条消息发送失败"，两者严重程度不同，不应该用同样醒目的提示
        console.error("[DSConversationStore] 保存本地对话数据失败：", err);
      })
      .then(function () {
        isSaving = false;
        if (pendingResave) {
          pendingResave = false;
          // 用调用方此刻能拿到的最新数据再存一次；这里直接要求调用方重新调用，
          // 而不是本模块自己缓存一份数据快照，避免本模块和业务层的数据源产生第二份"真相"
          if (typeof window.DSConversationStore.getLatestSnapshot === "function") {
            var latest = window.DSConversationStore.getLatestSnapshot();
            if (latest) {
              return saveNow(latest);
            }
          }
        }
      });
  }

  /**
   * 防抖保存：400ms 内多次调用只会在最后一次之后真正写入一次。
   * 用于高频场景（流式回复逐字追加时的中间状态）。
   * @param {Array} conversations
   */
  function scheduleSave(conversations) {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(function () {
      saveTimer = null;
      saveNow(conversations);
    }, SAVE_DEBOUNCE_MS);
  }

  window.DSConversationStore = {
    load: load,
    saveNow: saveNow,
    scheduleSave: scheduleSave,
    // 由 sidebar.js 在 init 时注入：返回"当前内存里最新、完整（含每个对话的 messages）"
    // 的对话数组快照，供 saveNow 在"写入期间又有新变化"时取最新数据补写一次
    getLatestSnapshot: null
  };
})();
