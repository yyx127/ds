/**
 * ============================================================
 * branches.js —— 对话消息分支（树状历史）核心算法
 * ============================================================
 * 【移植来源】deepseek-ai/chat-demo（真实仓库，GitHub 已核实存在，
 * https://github.com/deepseek-ai/chat-demo，默认分支 main），
 * 对应文件 src/services/chat/branches.ts，逐一核对过的真实源码，
 * 本文件把官方实现的 TypeScript 算法原样移植为本项目的 Vanilla JS 风格，
 * 数据结构、函数职责与官方实现保持一致，只是把 React/TS 特有部分
 * （纯类型标注、ES Module 导出）替换成普通函数 + window 命名空间导出。
 *
 * 【核心概念：这是"对话消息树分支"，不是 Git 分支】
 * 一次"重新生成"或"编辑后重发"，官方实现不会删除旧消息，而是在原消息
 * 的父节点下再挂一条新的兄弟消息（新分支），并把父节点的"当前选中子节点"
 * 指针指向新分支；旧分支的消息原样留在数组里，用户可以随时切换回去看。
 *
 * 【数据结构（与官方 types.ts 的 MessageBranch 字段完全一致）】
 * 每条消息对象在原有字段基础上，新增两个可选字段：
 *   - parentId: string | null | undefined —— 父消息的 id；根消息的 parentId 为 null；
 *     undefined 表示尚未规范化（兼容旧数据/线性历史）
 *   - selectedChildId: string | undefined —— 当前选中走向哪一个子节点；
 *     叶子节点（没有任何回复）该字段不存在
 * 会话级别新增字段：
 *   - rootMessageId: string | null | undefined —— undefined 表示线性列表（未规范化）；
 *     null 表示空对话；有值则是树的根节点 id
 *
 * 【与官方实现的对应关系】
 *   - normalizeSession() <-> 官方 normalizeSession()：把线性消息列表转换成
 *     单分支的树（parentId 指向上一条，selectedChildId 指向下一条），
 *     只在 rootMessageId 缺省（undefined）时才做转换，已经是树结构的数据不会被重复处理
 *   - getVisibleMessages() <-> 官方 getVisibleMessages()：从根节点开始，
 *     顺着每个节点的 selectedChildId 走一条链，就是"当前应该显示在屏幕上的路径"
 *   - buildMessageVersions() <-> 官方 buildMessageVersions()：按 parentId 分组收集
 *     兄弟节点，得到"这条消息是第几个版本/总共几个版本"，带缓存复用避免无意义重绘
 *   - appendBranch() <-> 官方 appendBranch()：在指定父节点下挂一条新分支（可能是
 *     一条或多条消息，例如"用户消息+AI回复"一起挂），并把父节点的选中指针切过去
 *   - selectVersion() <-> 官方 selectVersion()：切换到某条消息的某个兄弟版本，
 *     只改对应父节点的 selectedChildId，不碰其他任何数据
 * ============================================================
 */

(function () {
  "use strict";

  /**
   * 把线性消息列表（没有 parentId/selectedChildId 字段的旧数据）规范化为
   * 单分支的树结构：第一条消息的 parentId 为 null，之后每条消息的 parentId
   * 指向上一条，selectedChildId 指向下一条。
   * 已经规范化过的会话（rootMessageId 不是 undefined）原样返回，不重复处理
   * ——对应官方实现"只在 session.rootMessageId !== undefined 时才短路跳过"的判断。
   * @param {Array} messages 完整消息数组
   * @param {string|null|undefined} rootMessageId 当前会话记录的根节点 id
   * @returns {{ messages: Array, rootMessageId: string|null }}
   */
  function normalizeSession(messages, rootMessageId) {
    if (rootMessageId !== undefined) {
      return { messages: messages, rootMessageId: rootMessageId };
    }
    var normalized = messages.map(function (message, index) {
      return Object.assign({}, message, {
        parentId: index > 0 ? messages[index - 1].id : null,
        selectedChildId: index + 1 < messages.length ? messages[index + 1].id : undefined
      });
    });
    return {
      messages: normalized,
      rootMessageId: messages.length > 0 ? messages[0].id : null
    };
  }

  /**
   * 从根节点开始，沿着每个节点的 selectedChildId 走一条链，得到"当前选中路径"
   * 上的消息数组——这就是用户在屏幕上应该看到的那条对话线，其余分支的消息
   * 仍然留在 messages 数组里，只是不在这条路径上，不会被渲染。
   * @param {Array} messages 完整消息数组（树的全部节点）
   * @param {string|null|undefined} rootMessageId
   * @returns {Array} 当前选中路径上的消息（按顺序）
   */
  function getVisibleMessages(messages, rootMessageId) {
    if (rootMessageId === undefined) {
      // 未规范化的线性历史，整个数组就是路径本身
      return messages;
    }
    var byId = new Map();
    messages.forEach(function (message) {
      byId.set(message.id, message);
    });
    var path = [];
    var id = rootMessageId;
    // 用一个局部 Set 防止数据异常（环引用）时死循环，这是官方实现没有的
    // 防御性加固——官方实现靠"从 map 里 delete 已访问节点"自然防环，这里保留同样的做法
    var visited = new Set();
    while (id) {
      var message = byId.get(id);
      if (!message || visited.has(id)) {
        break;
      }
      visited.add(id);
      path.push(message);
      id = message.selectedChildId || null;
    }
    return path;
  }

  /**
   * 按 parentId 分组收集兄弟节点，算出每条消息"是第几个版本/总共几个版本"。
   * 带缓存复用：如果某一组兄弟节点的 id 列表和上一次完全一样，直接复用旧的
   * version 对象引用，避免流式回复逐字更新正文时，连历史消息的版本号 UI
   * 都被判定为"变了"而触发不必要的重绘（这是官方实现专门做的性能优化，
   * 对应注释"版本列表未变化时复用旧对象与索引，避免流式正文更新重绘历史消息"）。
   * @param {Array} messages 完整消息数组
   * @param {string|null|undefined} rootMessageId
   * @param {Map} previous 上一次计算出的版本信息（用于复用对比）
   * @returns {Map<string, {ids: string[], index: number}>}
   */
  function buildMessageVersions(messages, rootMessageId, previous) {
    previous = previous || new Map();
    var groups = new Map();
    messages.forEach(function (message) {
      var key = rootMessageId === undefined ? message.id : message.parentId;
      var ids = groups.get(key);
      if (ids) {
        ids.push(message.id);
      } else {
        groups.set(key, [message.id]);
      }
    });

    var versions = new Map();
    var unchanged = previous.size === messages.length;
    groups.forEach(function (ids) {
      var cached = previous.get(ids[0]);
      var cachedIds = cached ? cached.ids : null;
      var stableIds = sameIdList(cachedIds, ids) ? cachedIds : ids;
      ids.forEach(function (id, index) {
        var cachedForId = previous.get(id);
        var version =
          cachedForId && cachedForId.ids === stableIds && cachedForId.index === index
            ? cachedForId
            : { ids: stableIds, index: index };
        versions.set(id, version);
        if (version !== cachedForId) {
          unchanged = false;
        }
      });
    });
    return unchanged ? previous : versions;
  }

  /** 辅助函数：判断两个 id 数组是否完全一致（顺序也要一致）。 */
  function sameIdList(a, b) {
    if (!a || a.length !== b.length) {
      return false;
    }
    for (var i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        return false;
      }
    }
    return true;
  }

  /**
   * 在指定父节点下挂一条新分支（一条或多条消息，例如"编辑后的用户消息 + 新的
   * AI 回复"一起挂上去），并把父节点的 selectedChildId 指向新分支的第一条消息
   * ——这一步就是"切换到新分支"，旧的兄弟分支消息原样留在数组里，不会被删除，
   * 用户可以通过分支切换器随时切回去。
   * @param {Array} messages 完整消息数组
   * @param {string|null|undefined} rootMessageId
   * @param {string|null} parentId 新分支挂载的父节点 id；null 表示挂在根部（新开一条路径）
   * @param {Array} newMessages 要追加的新分支消息（会被补全 parentId/selectedChildId 字段）
   * @returns {{ messages: Array, rootMessageId: string|null }}
   */
  function appendBranch(messages, rootMessageId, parentId, newMessages) {
    var normalized = normalizeSession(messages, rootMessageId);
    var first = newMessages[0];
    if (!first) {
      return normalized;
    }
    var nextMessages = normalized.messages
      .map(function (message) {
        return message.id === parentId
          ? Object.assign({}, message, { selectedChildId: first.id })
          : message;
      })
      .concat(
        newMessages.map(function (message, index) {
          return Object.assign({}, message, {
            parentId: index > 0 ? newMessages[index - 1].id : parentId,
            selectedChildId: index + 1 < newMessages.length ? newMessages[index + 1].id : undefined
          });
        })
      );
    return {
      messages: nextMessages,
      rootMessageId: parentId === null ? first.id : normalized.rootMessageId
    };
  }

  /**
   * 切换到某条消息的某个兄弟版本：只改该消息的父节点的 selectedChildId，
   * 不删除、不修改任何其他消息——这是"分支切换器"点左右箭头时调用的函数。
   * 官方实现额外校验了"该消息必须真的在当前可见路径的兄弟组里"才允许切换，
   * 本文件保留同样的校验（防止切换一个不在当前路径上下文里的孤立节点）。
   * @param {Array} messages 完整消息数组
   * @param {string|null|undefined} rootMessageId
   * @param {string} messageId 要切换到的目标消息 id
   * @returns {{ messages: Array, rootMessageId: string|null }} 切换失败时原样返回输入
   */
  function selectVersion(messages, rootMessageId, messageId) {
    var normalized = normalizeSession(messages, rootMessageId);
    var message = normalized.messages.find(function (item) {
      return item.id === messageId;
    });
    if (!message) {
      return normalized;
    }
    var visiblePath = getVisibleMessages(normalized.messages, normalized.rootMessageId);
    var isReachableSibling = visiblePath.some(function (item) {
      return item.parentId === message.parentId;
    });
    if (!isReachableSibling) {
      return normalized;
    }
    return {
      messages: normalized.messages.map(function (item) {
        return item.id === message.parentId
          ? Object.assign({}, item, { selectedChildId: message.id })
          : item;
      }),
      rootMessageId: message.parentId === null ? message.id : normalized.rootMessageId
    };
  }

  window.DSBranches = {
    normalizeSession: normalizeSession,
    getVisibleMessages: getVisibleMessages,
    buildMessageVersions: buildMessageVersions,
    appendBranch: appendBranch,
    selectVersion: selectVersion
  };
})();
