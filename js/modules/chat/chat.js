/**
 * ============================================================
 * chat.js —— 消息分支树状态管理 + 通用 API 对接
 * ============================================================
 * 职责范围：
 *   1. 每个对话的消息用真实的"分支树"模型维护（核心算法见 js/core/branches.js，
 *      移植自 deepseek-ai/chat-demo 官方实现）：conversationTrees 按对话 id
 *      存放 { messages: 全部分支节点, rootMessageId }；getMessages(id) 返回
 *      "当前选中路径"上的线性历史，供发送请求/渲染/token 统计等只关心
 *      线性历史的逻辑直接使用。重新生成、编辑重发都是"挂一条新分支"，
 *      旧版本永远不会被删除，用户可以通过消息旁的分支切换器随时切回去看。
 *   2. 若本地 API 配置已填写完整（Base URL + 模型名），通过
 *      window.DSApiClient 发起真实请求，兼容流式（SSE 逐字渲染）与
 *      非流式两种模式；否则自动降级为本地模拟回复（早期 Step 遗留的演示能力，
 *      方便未配置任何接口时也能预览完整的消息交互效果）
 *   3. AI 返回的 thinking 字段自动渲染到折叠思考面板（流式时增量追加）
 *   4. 统一错误处理：网络错误 / 鉴权失败 / 限流 / 超时 / 参数错误等
 *      分别展示对应中文 Toast 提示
 *   5. 停止生成：请求进行中点击停止按钮可中断当前请求（真实请求通过
 *      AbortController 中断网络连接；模拟回复通过清除 setTimeout 中断）
 *   6. 自动滚动到底部；用户手动上滑时暂停自动滚动，滑回底部恢复
 *   7. AI 消息复制 / 重新生成（新分支）、用户消息编辑重发（新分支）、清空当前对话
 *   8. 真实持久化：对话树与消息整体存入 IndexedDB（见
 *      js/core/conversation-store.js + sidebar.js 的 persistNow），刷新页面不丢失，
 *      切换到的任意分支也会被完整保存。
 *   9. 发真实请求前按需触发上下文压缩（js/core/compression.js），压缩只生成
 *      一份独立的"压缩记录"，不删除/不改动任何原始消息。
 *
 * 请求参数（temperature / max_tokens / 是否流式 / 是否思考模式等）统一从
 * window.DSUserConfig（本地配置）读取，本文件不写死任何数值。
 * ============================================================
 */

(function () {
  "use strict";

  var el = {};

  // 空状态欢迎语文案池：每次空状态出现时随机挑一句，不是固定文字；
  // 语气保持简短、轻松，呼应整体治愈风格，不与小鲸鱼图标的"萌"感冲突
  var EMPTY_STATE_GREETINGS = [
    "欢迎回来～",
    "开始聊天吧！",
    "今天想聊点什么？",
    "有什么可以帮你的？",
    "嗨，我在这儿～",
    "随时可以开始哦",
    "想到什么都可以说说"
  ];

  // ---------------- 模块内状态 ----------------
  // 按对话 id 维护的消息树：{ [conversationId]: { messages: Array<全部节点>, rootMessageId } }
  // 这是真实的"消息分支"模型（算法移植自 deepseek-ai/chat-demo 官方实现，
  // 见 js/core/branches.js）：messages 存的是树的全部节点（含所有历史分支，
  // 重新生成/编辑产生的旧版本永远不会被删除），rootMessageId 指向树的根，
  // 每个节点的 parentId/selectedChildId 决定"当前显示哪条路径"。
  // MessageObject 结构：{ id, role: 'user'|'assistant', content, thinking?,
  //   parentId, selectedChildId }
  // 日常读取用 getMessages(id) 拿到的是"当前选中路径"的线性数组（供发送请求、
  // 渲染、token 统计等只关心线性历史的逻辑直接使用，不需要关心树结构本身）；
  // 需要操作树本身（分支切换、挂新分支）时用 getConversationTree(id)。
  var conversationTrees = {};

  // 当前正在渲染/交互的对话 id（与侧边栏的 activeId 保持同步）
  var currentConversationId = null;

  // 是否处于“生成中”状态（发送按钮 <-> 停止按钮）
  var isGenerating = false;
  // 每次开始一轮新生成（包括压缩阶段）都会自增的令牌：用于识别"异步压缩完成时，
  // 当前这轮生成是否已经被用户点停止、或被更新的一轮生成取代"，见 maybeAutoCompact 的用法
  var currentGeneratingToken = 0;
  // 当前本地模拟流式输出所使用的定时器 id，供“停止”立即清除（仅模拟回复路径使用）
  var streamTimer = null;
  // 当前真实 API 请求的中断控制器引用（DSApiClient.sendChatRequest 的返回值，仅真实请求路径使用）
  // 结构为 { abort: Function }，调用 .abort() 即可中断底层网络请求
  var currentRequestHandle = null;
  // 自动滚动是否暂停（用户手动上滑后置为 true，滑回底部后恢复 false）
  var autoScrollPaused = false;
  // 标记当前是否是脚本触发的滚动（避免脚本自己滚动触发 scroll 事件被误判为“用户上滑”）
  var isProgrammaticScroll = false;

  function cacheDom() {
    el.messageList = document.getElementById("message-list");
    el.emptyState = document.getElementById("empty-state");
    el.emptyStateGreeting = document.getElementById("empty-state-greeting");
    el.chatArea = document.getElementById("chat-area");
    el.btnScrollBottom = document.getElementById("btn-scroll-bottom");
    el.textarea = document.getElementById("textarea-message");
    el.btnSend = document.getElementById("btn-send");
    el.btnCompressContext = document.getElementById("btn-compress-context");
    el.btnClearCurrentChat = document.getElementById("btn-clear-current-chat");
    el.mainHeaderTitle = document.getElementById("main-header-title");
    el.compressStatusBar = document.getElementById("compress-status-bar");
    el.compressStatusBarInfo = document.getElementById("compress-status-bar__info");
    el.compressStatusBarProgress = document.getElementById("compress-status-bar__progress");
    el.compressStatusBarProgressText = document.getElementById("compress-status-bar__progress-text");
  }

  // ================================================================
  // 消息状态读写（真实分支树模型，核心算法见 js/core/branches.js）
  // ================================================================

  /**
   * 获取指定对话的完整树（含全部分支节点 + 当前根节点 id）；不存在时初始化为空树。
   * 需要操作树结构本身（挂新分支、切换分支）时使用这个，而不是 getMessages。
   * @param {string} convId
   * @returns {{ messages: Array, rootMessageId: string|null }}
   */
  function getConversationTree(convId) {
    if (!convId) {
      return { messages: [], rootMessageId: null };
    }
    if (!conversationTrees[convId]) {
      conversationTrees[convId] = { messages: [], rootMessageId: null };
    }
    return conversationTrees[convId];
  }

  /**
   * 整体替换指定对话的树（挂新分支/切换分支后，用 js/core/branches.js 算出的
   * 新树整体写回；不做增量 patch，保持"树的更新永远是整体替换"这一简单心智模型，
   * 与官方实现里 updateSession 的不可变更新风格一致）。
   * @param {string} convId
   * @param {{ messages: Array, rootMessageId: string|null }} tree
   */
  function setConversationTree(convId, tree) {
    conversationTrees[convId] = tree;
  }

  /**
   * 获取指定对话"当前选中路径"上的消息——这是日常绝大多数逻辑（发送请求、
   * 渲染、token 统计、压缩引擎）真正关心的"线性历史"，调用方不需要感知树结构。
   * 【只读】返回的数组不应该被直接 push/splice——分支树模型下，任何"新增/
   * 替换消息"的操作都必须通过 appendBranch 生成一棵新树再 setConversationTree，
   * 而不是直接修改这个数组（否则会破坏 parentId/selectedChildId 的一致性）。
   * @param {string} convId
   * @returns {Array}
   */
  function getMessages(convId) {
    var tree = getConversationTree(convId);
    return window.DSBranches.getVisibleMessages(tree.messages, tree.rootMessageId);
  }

  /**
   * 将对话对象里预置的 messages（来自 mock-data.js 的演示历史，或 IndexedDB
   * 恢复的真实历史）导入内存状态，仅在该对话首次被访问、内存中还没有记录时
   * 执行一次，避免重复覆盖用户在本次会话中产生的新消息。
   * 导入时用 normalizeSession 规范化：旧的线性历史（没有 parentId 字段）会被
   * 自动转换成单分支的树，真正带分支的历史（已经有 rootMessageId）原样保留。
   * @param {Object} conv 侧边栏提供的对话对象（可能为 null）
   */
  function ensureConversationLoaded(conv) {
    if (!conv) {
      return;
    }
    if (!conversationTrees[conv.id]) {
      // 深拷贝一份，避免直接引用侧边栏数据对象，防止互相修改造成副作用
      var rawMessages = Array.isArray(conv.messages) ? JSON.parse(JSON.stringify(conv.messages)) : [];
      conversationTrees[conv.id] = window.DSBranches.normalizeSession(rawMessages, conv.rootMessageId);
    }
  }

  function generateMessageId(prefix) {
    return (prefix || "msg") + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
  }

  /**
   * 在指定对话的树上挂一条新分支（一条或多条消息），并把结果整体写回
   * conversationTrees——这是本文件里"新增消息"的唯一入口，取代了旧版本
   * 直接 messages.push(...) 的写法。调用 js/core/branches.js 的 appendBranch，
   * 旧的兄弟分支（例如被重新生成替换掉的旧回答）不会被删除，只是不再是
   * "当前选中路径"的一部分，用户可以通过分支切换器随时切回去。
   * @param {string} convId
   * @param {string|null} parentId 新分支挂载的父节点 id；null 表示挂在根部
   * @param {Array} newMessages 要追加的新分支消息（1 条或多条，例如"提问+回答"一起挂）
   */
  function appendToTree(convId, parentId, newMessages) {
    var tree = getConversationTree(convId);
    var next = window.DSBranches.appendBranch(tree.messages, tree.rootMessageId, parentId, newMessages);
    setConversationTree(convId, next);
  }

  /**
   * 触发一次持久化保存（防抖版本），在任何改变了某个对话消息内容的操作之后调用。
   * 真正的保存逻辑在 js/core/conversation-store.js，这里只是触发点；
   * 若该模块或侧边栏模块未加载（极端情况），静默跳过，不影响聊天功能本身。
   */
  function persistConversations() {
    if (window.DSSidebar && typeof window.DSSidebar.persistNow === "function") {
      window.DSSidebar.persistNow();
    }
  }

  /**
   * 立即持久化（跳过防抖），用于"停止生成""切换对话前""清空对话后"等
   * 必须马上落盘、不能再等 400ms 的场景。
   */
  function persistConversationsNow() {
    if (window.DSSidebar && typeof window.DSSidebar.persistNow === "function") {
      window.DSSidebar.persistNow(true);
    }
  }

  /**
   * 取指定对话"当前可见路径"最后一条消息的 id，作为压缩记录的分支标识
   * （leafId）——同一条可见路径必然对应同一个叶子 id，切换分支后叶子 id
   * 必然不同，天然做到"每个分支的压缩记录互不干扰"，不需要手动清空。
   * @param {string} conversationId
   * @returns {string|null}
   */
  function getCurrentLeafId(conversationId) {
    var visible = getMessages(conversationId);
    return visible.length > 0 ? visible[visible.length - 1].id : null;
  }

  /**
   * 刷新对话界面顶部的压缩状态条：显示当前对话（当前分支）的消息数、token 占用、
   * 是否已有压缩摘要、已节省多少 token。没有消息时整条隐藏，不占地方。
   * 这是原来设置面板「对话压缩」Tab 里的状态卡片逻辑搬过来的——压缩是"当前
   * 对话正在发生的事"，应该直接长在对话界面上，不需要跳出去设置里看。
   */
  function refreshCompressStatusBar() {
    if (!el.compressStatusBar || !el.compressStatusBarInfo) {
      return;
    }
    if (!window.DSCompression || !window.DSCompressionSettings || !currentConversationId) {
      el.compressStatusBar.hidden = true;
      return;
    }
    var messages = getMessages(currentConversationId);
    if (!messages.length) {
      el.compressStatusBar.hidden = true;
      return;
    }
    el.compressStatusBar.hidden = false;

    var cfg = window.DSCompressionSettings.getConfig();
    var rawTokens = window.DSCompression.estimateMessagesTokens(messages);
    var currentLeafId = getCurrentLeafId(currentConversationId);
    var record = window.DSCompressionRecords
      ? window.DSCompressionRecords.getRecord(currentConversationId, currentLeafId)
      : null;

    var effectiveTokens = rawTokens;
    var savedTokens = 0;
    if (record && window.DSCompression.frameSummary) {
      var shadowedIdSet = {};
      record.shadowedMessageIds.forEach(function (id) {
        shadowedIdSet[id] = true;
      });
      var shadowedTokens = 0;
      var remainTokens = 0;
      messages.forEach(function (m) {
        if (shadowedIdSet[m.id]) {
          shadowedTokens += window.DSCompression.estimateMessageTokens(m);
        } else {
          remainTokens += window.DSCompression.estimateMessageTokens(m);
        }
      });
      var summaryTokens = window.DSCompression.estimateTokensRough(window.DSCompression.frameSummary(record.summary));
      effectiveTokens = remainTokens + summaryTokens;
      savedTokens = Math.max(0, shadowedTokens - summaryTokens);
    }
    var ratio = cfg.contextWindow > 0 ? effectiveTokens / cfg.contextWindow : 0;

    var html =
      "消息 " + messages.length + " 条 · " +
      "占用 <strong>" + effectiveTokens + " / " + cfg.contextWindow + "</strong>（" + Math.round(ratio * 100) + "%）";
    if (record) {
      html += " · 已压缩节省 <strong>" + savedTokens + "</strong> tokens（" + record.shadowedMessageIds.length + " 条旧消息用摘要代替）";
    }
    el.compressStatusBarInfo.innerHTML = html;
  }

  /**
   * 作废指定对话"当前这条分支"的压缩记录（如果有）。在编辑消息、重新生成、
   * 清空对话这类"直接改变了当前分支结构本身"的操作之后调用——压缩摘要是
   * 基于"某一时刻的历史快照"生成的，历史结构一旦变化，旧摘要就不再准确
   * 代表新的上下文，必须作废；下次触发压缩时会基于最新历史重新生成一份。
   * 【注意】切换分支不调用这个函数——切分支只是换到另一个 leafId，
   * 会自动读到那个分支自己的压缩记录（或者没有），不需要清空任何东西。
   * @param {string} conversationId
   * @param {string} leafId 要作废的分支的叶子 id
   */
  function invalidateCompressionRecord(conversationId, leafId) {
    if (window.DSCompressionRecords) {
      window.DSCompressionRecords.clearRecord(conversationId, leafId);
    }
  }

  // ================================================================
  // 渲染：根据当前对话的消息状态，全量重绘消息列表
  // ================================================================

  // 每个对话的分支版本信息缓存：{ [conversationId]: Map<messageId, {ids, index}> }，
  // 用于 buildMessageVersions 的"输入不变就复用旧 Map 引用"性能优化（见 branches.js）。
  var messageVersionsCache = {};

  /**
   * 根据 currentConversationId 对应的消息数组，重新渲染整个消息列表。
   * 用于「切换对话」「清空当前对话」等需要整体刷新的场景；
   * 日常的“发送一条新消息”则采用增量 DOM 追加（见 appendUserMessage 等），
   * 避免每次发消息都整列表重绘导致的性能浪费和滚动位置跳动。
   */
  function renderConversation() {
    if (!el.messageList) {
      return;
    }
    // 清空除空状态节点以外的所有消息行
    var rows = el.messageList.querySelectorAll(".message-row");
    rows.forEach(function (row) {
      row.parentNode.removeChild(row);
    });

    var messages = getMessages(currentConversationId);
    if (!messages.length) {
      toggleEmptyState(true);
      refreshCompressStatusBar();
      return;
    }
    toggleEmptyState(false);

    var versions = computeMessageVersions(currentConversationId);
    var fragment = document.createDocumentFragment();
    messages.forEach(function (msg) {
      fragment.appendChild(buildMessageRow(msg, versions.get(msg.id)));
    });
    el.messageList.appendChild(fragment);

    if (window.DSIcons) {
      window.DSIcons.render(el.messageList);
    }

    // 切换对话后强制滚动到底部，并重置“暂停自动滚动”标记（新对话从底部开始看）
    autoScrollPaused = false;
    scrollToBottom(true);
    refreshCompressStatusBar();
  }

  /**
   * 计算（并缓存）指定对话当前的分支版本信息。
   * @param {string} convId
   * @returns {Map<string, {ids: string[], index: number}>}
   */
  function computeMessageVersions(convId) {
    var tree = getConversationTree(convId);
    var previous = messageVersionsCache[convId] || new Map();
    var versions = window.DSBranches.buildMessageVersions(tree.messages, tree.rootMessageId, previous);
    messageVersionsCache[convId] = versions;
    return versions;
  }

  /**
   * 根据消息角色构建对应的 DOM 行，并挂接统一的操作按钮回调。
   * @param {Object} msg
   * @param {{ids: string[], index: number}} [versions] 该消息所在分支组的版本信息，
   *   ids.length > 1 时会在气泡旁渲染分支切换器（‹ 2/3 › 样式）
   */
  function buildMessageRow(msg, versions) {
    if (!window.DSChatDemo) {
      console.warn("[DSChat] 未检测到 window.DSChatDemo 工具库，消息无法正常渲染。");
      var fallback = document.createElement("div");
      fallback.textContent = msg.content;
      return fallback;
    }
    var handlers = {
      onSelectVersion: handleSelectVersion,
      versions: versions
    };
    if (msg.role === "user") {
      return window.DSChatDemo.buildUserMessage(msg, Object.assign({ onEdit: handleEditUserMessage }, handlers));
    }
    return window.DSChatDemo.buildAssistantMessage(msg, Object.assign({ onRegenerate: handleRegenerate }, handlers));
  }

  /**
   * 分支切换器的点击回调：切换到目标消息版本，重新渲染整个对话
   * （切换分支意味着从那个节点往后的整条路径都可能变化，不是局部增量更新能覆盖的场景，
   * 与官方实现"切换版本后重新整体渲染"的做法一致）。
   * @param {string} messageId 目标版本的消息 id
   */
  function handleSelectVersion(messageId) {
    if (isGenerating) {
      if (window.DSToast) {
        window.DSToast.warning("正在生成中，请先停止当前生成后再切换分支");
      }
      return;
    }
    var tree = getConversationTree(currentConversationId);
    var next = window.DSBranches.selectVersion(tree.messages, tree.rootMessageId, messageId);
    setConversationTree(currentConversationId, next);
    // 切换分支不清空压缩记录：每个分支按自己的叶子 id 独立存一份，
    // 切过去后 getCurrentLeafId 自然会读到那条分支自己的记录（或者它确实还没压缩过）
    persistConversationsNow();
    renderConversation();
  }

  /**
   * 回复完成后刷新一次指定气泡行上的分支切换器徽标（例如重新生成产生了新版本，
   * 需要立刻从"没有切换器"变成"‹ 1/2 ›"，不用整体重绘整个对话列表）。
   * @param {HTMLElement} row
   * @param {string} messageId
   */
  function refreshBranchSwitcherForRow(row, messageId) {
    if (!row || !window.DSChatDemo || !window.DSChatDemo.updateBranchSwitcher) {
      return;
    }
    var versions = computeMessageVersions(currentConversationId).get(messageId);
    window.DSChatDemo.updateBranchSwitcher(row, versions, handleSelectVersion);
  }

  /**
   * 切换空状态欢迎页的显示/隐藏。每次从隐藏变为显示时，从文案池里随机挑一句
   * 欢迎语填入，做到"每次打开不一样"；重复调用 show=true（例如同一个空对话
   * 反复触发渲染）不会频繁换文案，只有真正"从无到有"展示空状态时才换一次。
   * @param {boolean} show
   */
  function toggleEmptyState(show) {
    if (!el.emptyState) {
      return;
    }
    // 边界处理：首次加载时 style.display 还是初始空字符串（不等于 "none"），
    // 但那其实也是"第一次展示空状态"，所以额外用 greeting 文本是否为空来兜底判断，
    // 避免首次加载时欢迎语一直是空的，要等用户切换一次对话才会被填入。
    var wasHidden = el.emptyState.style.display === "none";
    var greetingNotSetYet = el.emptyStateGreeting && !el.emptyStateGreeting.textContent;
    if (show && (wasHidden || greetingNotSetYet) && el.emptyStateGreeting) {
      var randomIndex = Math.floor(Math.random() * EMPTY_STATE_GREETINGS.length);
      el.emptyStateGreeting.textContent = EMPTY_STATE_GREETINGS[randomIndex];
    }
    el.emptyState.style.display = show ? "" : "none";
  }

  // ================================================================
  // 自动滚动 与 「用户上滑暂停」逻辑
  // ================================================================

  var SCROLL_BOTTOM_THRESHOLD = 80; // 距底部多少像素以内视为“在底部”

  function isNearBottom() {
    if (!el.messageList) {
      return true;
    }
    var distance = el.messageList.scrollHeight - el.messageList.scrollTop - el.messageList.clientHeight;
    return distance <= SCROLL_BOTTOM_THRESHOLD;
  }

  /**
   * 滚动到底部。
   * @param {boolean} [force] 为 true 时无视 autoScrollPaused 强制滚动（用于切换对话/发送新消息等场景）
   */
  function scrollToBottom(force) {
    if (!el.messageList) {
      return;
    }
    if (autoScrollPaused && !force) {
      // 用户正处于手动上滑查看历史的状态，不打断其阅读体验
      return;
    }
    isProgrammaticScroll = true;
    el.messageList.scrollTop = el.messageList.scrollHeight;
    // 下一帧复位标记，给 scroll 事件回调留出判断窗口
    requestAnimationFrame(function () {
      isProgrammaticScroll = false;
    });
    updateScrollBottomButton();
  }

  function updateScrollBottomButton() {
    if (!el.btnScrollBottom) {
      return;
    }
    el.btnScrollBottom.hidden = isNearBottom();
  }

  /**
   * 消息列表的 scroll 事件处理：
   * - 若是脚本自己触发的滚动（isProgrammaticScroll），忽略，不影响暂停状态
   * - 若用户向上滑动离开底部，暂停自动滚动
   * - 若用户滑回底部附近，恢复自动滚动
   */
  function handleMessageListScroll() {
    updateScrollBottomButton();
    if (isProgrammaticScroll) {
      return;
    }
    if (isNearBottom()) {
      autoScrollPaused = false;
    } else {
      autoScrollPaused = true;
    }
  }

  // ================================================================
  // 发送消息 / 生成中状态
  // ================================================================

  /**
   * 切换发送按钮为“生成中（停止）”视觉态，供 input.js 与本模块共用同一套按钮状态。
   */
  function setGeneratingState(generating) {
    isGenerating = generating;
    if (generating) {
      // 新一轮生成开始（发送/重新生成/编辑重发），让任何仍在等待中的上一轮
      // 压缩继续动作（见 maybeAutoCompact）识别出自己已经过期
      currentGeneratingToken += 1;
    }
    if (!el.btnSend) {
      return;
    }
    el.btnSend.classList.toggle("is-generating", generating);
    el.btnSend.setAttribute("aria-label", generating ? "停止生成" : "发送消息");
    var iconSpan = el.btnSend.querySelector(".icon");
    if (iconSpan) {
      iconSpan.setAttribute("data-icon", generating ? "stop" : "send");
      iconSpan.removeAttribute("data-icon-rendered");
      if (window.DSIcons) {
        window.DSIcons.render(el.btnSend);
      }
    }
    // 通知输入栏模块联动更新“发送按钮禁用态”（输入栏模块暴露了对应方法）
    if (window.DSInput && typeof window.DSInput.syncSendButtonState === "function") {
      window.DSInput.syncSendButtonState();
    }
  }

  function isCurrentlyGenerating() {
    return isGenerating;
  }

  /**
   * 发送一条用户消息（由 input.js 的发送按钮/Enter 键调用）。
   * 流程：写入状态 -> 增量渲染用户气泡 -> 更新侧边栏预览/标题 -> 插入加载行 -> 延迟后模拟流式回复。
   * @param {string} content 已经过 trim 且非空校验的用户输入内容
   */
  function sendUserMessage(content, attachments) {
    if (!currentConversationId) {
      // 边界处理：理论上不会发生（侧边栏总有一个 activeId），兜底创建一个临时对话 id，
      // 避免消息“发出去了却没有归属对话”的数据丢失问题。
      currentConversationId = "local-" + Date.now();
    }
    // 新消息挂在"当前可见路径最后一条消息"之下（没有历史消息时挂在根部，parentId 为 null）
    var visibleBefore = getMessages(currentConversationId);
    var parentId = visibleBefore.length > 0 ? visibleBefore[visibleBefore.length - 1].id : null;

    // attachments 为 input.js 传入的附件元信息快照（见 js/modules/input/attachments.js），
    // 仅用于气泡展示，不参与真实发给模型的上下文拼装（多模态发送留给后续对接具体厂商适配层）
    var userMsg = {
      id: generateMessageId("u"),
      role: "user",
      content: content,
      files: Array.isArray(attachments) ? attachments : []
    };
    appendToTree(currentConversationId, parentId, [userMsg]);
    var messages = getMessages(currentConversationId); // 挂好分支后重新取一次最新的可见路径
    persistConversations();

    toggleEmptyState(false);
    var userRow = buildMessageRow(userMsg);
    el.messageList.appendChild(userRow);
    if (window.DSIcons) {
      window.DSIcons.render(userRow);
    }
    scrollToBottom(true);
    refreshCompressStatusBar();

    // 同步侧边栏：更新最后一条消息预览、更新时间，并在这是对话首条消息时自动生成标题
    syncSidebarAfterMessage(userMsg, messages);

    // 插入「AI 加载中」占位行（三点动效）
    var loadingRowId = "loading-row-" + Date.now();
    var loadingRow = window.DSChatDemo ? window.DSChatDemo.buildLoadingMessage(loadingRowId) : null;
    if (loadingRow) {
      el.messageList.appendChild(loadingRow);
      scrollToBottom();
    }

    setGeneratingState(true);
    // 回复要挂在刚发出的这条用户消息下面（userMsg.id），而不是笼统地"追加到数组末尾"
    triggerAssistantReply(loadingRow, messages, content, userMsg.id);
  }

  // ================================================================
  // AI 回复分发：真实 API 请求 优先，未配置时自动降级为本地模拟回复
  // ================================================================

  /**
   * 触发一次 AI 回复：若本地已配置好可用的 API（Base URL + 模型名），走真实请求；
   * 否则走 Step 4 遗留的本地模拟回复（方便没有任何配置时也能预览完整交互效果）。
   * 这是 sendUserMessage / applyEditAndResend / handleRegenerate 三处发起回复的统一入口。
   * @param {HTMLElement|null} loadingRow
   * @param {Array} messages 当前对话"可见路径"的只读消息数组（供组装请求/模拟回复关键词匹配用）
   * @param {string} userContent 本轮触发回复的用户输入内容
   * @param {string|null} replyParentId 新回复要挂到树上的父节点 id
   *   （sendUserMessage 传新用户消息的 id；重新生成/编辑重发传对应用户消息的 id）
   */
  function triggerAssistantReply(loadingRow, messages, userContent, replyParentId) {
    if (window.DSUserConfig && window.DSUserConfig.isApiConfigReady()) {
      // 真实请求前先检查是否需要自动压缩历史（见 js/core/compression.js，
      // 算法移植自 DeepSeek Harness 官方压缩实现）；模拟回复路径不涉及真实
      // token 压力，不需要触发压缩。
      // 边界处理：压缩请求本身也需要几秒钟，如果用户在这段等待期间就点了
      // “停止”，generatingToken 会在 stopGenerating 里失效，压缩完成后必须
      // 识别出"已经不是当前这轮生成了"，不能再继续发起真实请求、也不能
      // 把按钮状态重新掰回生成中。
      var generatingToken = currentGeneratingToken;
      maybeAutoCompact(messages).then(function () {
        if (generatingToken !== currentGeneratingToken) {
          return; // 已经被停止或新一轮生成覆盖，本次压缩的后续动作全部作废
        }
        runRealAssistantReply(loadingRow, messages, userContent, replyParentId);
      });
    } else {
      // 边界处理：未配置时明确提示用户当前是模拟回复，避免用户误以为接口已生效
      if (window.DSToast) {
        window.DSToast.warning("未配置 API，当前为本地模拟回复（可在设置中填写接口信息）");
      }
      streamTimer = setTimeout(function () {
        runFakeAssistantReply(loadingRow, messages, userContent, replyParentId);
      }, 800);
    }
  }

  /**
   * 自动压缩钩子：发真实请求前检查当前对话的上下文压力，超过阈值时调用
   * js/core/compression.js 的压缩引擎生成一份压缩记录（js/core/compression-records.js）。
   * 【不删除、不替换任何原始消息】——conversationTrees 里的树、页面上的
   * 每一条气泡都完全不受影响，用户可以随时往上翻看完整原文、编辑/重新生成
   * 任意一条历史消息。真正"省 token"的效果发生在 buildApiMessages 组装
   * 发给模型的请求体这一步，用压缩记录动态换掉被覆盖的那一段。
   * 压缩失败或未触发压缩时静默跳过，绝不阻断正常发送流程——压缩是性能优化，
   * 不是发送消息的必要前提。
   * @param {Array} messages
   * @returns {Promise<void>}
   */
  function maybeAutoCompact(messages) {
    var cfg = window.DSCompressionSettings ? window.DSCompressionSettings.getConfig() : null;
    if (!cfg || !cfg.enabled || !window.DSCompression || !window.DSCompressionRecords) {
      return Promise.resolve();
    }
    if (!window.DSCompression.isUnderPressure(messages, cfg)) {
      return Promise.resolve();
    }
    var targetConversationId = currentConversationId;
    // 记住"压缩的是哪条分支"：取这次参与压缩的 messages 的最后一条 id，
    // 之后 buildApiMessages 要用同一个 leafId 才能读到这份记录（见下方说明）
    var leafId = messages.length > 0 ? messages[messages.length - 1].id : null;
    return window.DSCompression
      .compactConversation(targetConversationId, messages, cfg)
      .then(function (result) {
        if (result.compacted) {
          window.DSCompressionRecords.setRecord(targetConversationId, leafId, {
            shadowedMessageIds: result.shadowedMessageIds,
            summary: result.summary
          });
          if (window.DSToast) {
            window.DSToast.success(
              "已生成历史摘要（" + result.shadowedCount + " 条旧消息），下一轮发送会自动精简上下文；" +
                "聊天记录本身完整保留，可随时翻看"
            );
          }
          if (targetConversationId === currentConversationId) {
            refreshCompressStatusBar();
          }
        }
      })
      .catch(function (err) {
        // 压缩失败（摘要请求出错、网络问题等）只记录日志，不打扰用户、不阻断发送，
        // 本轮继续用未压缩的原始历史发送请求
        console.warn("[DSChat] 自动压缩失败，本轮使用未压缩的历史继续发送：", err);
      });
  }

  /**
   * 将内存中的消息数组转换为标准 OpenAI 格式的 messages 数组（role + content），
   * 供真实 API 请求使用。思考内容（thinking）不作为上下文回传给模型——
   * 它只是模型上一轮的思考过程展示，不属于对话内容本身。
   *
   * 【压缩记录在这里生效】若该对话存在压缩记录（js/core/compression-records.js），
   * 被记录覆盖的那一段原始消息在这里会被跳过、改用一条摘要消息顶替在原来的位置，
   * 这个替换只影响这一次"即将发出的请求体"，不修改传入的 messages 数组本身——
   * 调用方拿到的仍然是完整、未经改动的原始历史，可以放心继续用于渲染/持久化。
   * @param {Array} messages
   * @returns {Array<{role: string, content: string}>}
   */
  function buildApiMessages(messages) {
    // 当前版本暂无独立的「系统提示词」输入 UI（留给后续 Step），
    // 这里预留组装位置：若对话对象上存在 systemPrompt 字段，则放在数组最顶部且永不改动。
    var apiMessages = [];
    var conv = window.DSSidebar ? window.DSSidebar.getActiveConversation() : null;
    if (conv && conv.systemPrompt && conv.systemPrompt.trim()) {
      apiMessages.push({ role: "system", content: conv.systemPrompt.trim() });
    }

    var currentLeafId = messages.length > 0 ? messages[messages.length - 1].id : null;
    var record = window.DSCompressionRecords
      ? window.DSCompressionRecords.getRecord(currentConversationId, currentLeafId)
      : null;
    var summaryInserted = false;
    messages.forEach(function (m) {
      var isShadowed = record && record.shadowedMessageIds.indexOf(m.id) !== -1;
      if (isShadowed) {
        // 被压缩记录覆盖的原始消息：在请求体里整体跳过，只在第一次遇到时
        // 插入一条摘要消息顶替这一整段，后续同样被覆盖的消息不再重复插入
        if (!summaryInserted && window.DSCompression) {
          apiMessages.push({ role: "user", content: window.DSCompression.frameSummary(record.summary) });
          summaryInserted = true;
        }
        return;
      }
      apiMessages.push({ role: m.role, content: m.content });
    });
    return apiMessages;
  }

  /**
   * 真实 API 请求路径：调用 DSApiClient 发起请求，流式模式下逐字渲染到消息气泡，
   * 思考内容（thinking）若存在则增量渲染到折叠面板；非流式模式下一次性渲染完整结果。
   * @param {HTMLElement|null} loadingRow
   * @param {Array} messages
   * @param {string} userContent
   * @param {string|null} replyParentId 完成后把这条回复挂到树上的父节点 id
   */
  function runRealAssistantReply(loadingRow, messages, userContent, replyParentId) {
    var assistantMsg = { id: generateMessageId("a"), role: "assistant", thinking: "", content: "" };

    // 构建流式展示专用的 DOM 结构：思考面板容器（内容为空时先不插入，首次收到 thinking 增量再创建）+ 正文 + 光标
    var row = document.createElement("div");
    row.className = "message-row message-row--assistant";
    row.dataset.id = assistantMsg.id;
    var col = document.createElement("div");
    col.className = "message-col";

    var thinkingPanelRef = null; // 延迟创建：只有真的收到 thinking 内容时才插入面板，避免空面板占位
    var thinkingContentEl = null;

    var bubble = document.createElement("div");
    bubble.className = "message-bubble markdown-body";
    var textSpan = document.createElement("span");
    bubble.appendChild(textSpan);
    var cursor = document.createElement("span");
    cursor.className = "stream-cursor";
    bubble.appendChild(cursor);
    col.appendChild(bubble);
    row.appendChild(col);

    if (loadingRow && loadingRow.parentNode) {
      loadingRow.parentNode.replaceChild(row, loadingRow);
    } else if (el.messageList) {
      el.messageList.appendChild(row);
    }

    /**
     * 首次收到思考内容增量时，动态创建并插入思考折叠面板（插在气泡之前）。
     * 真实接口的思考内容通常也需要流式展示，因此面板默认直接展开，
     * 让用户能看到思考过程逐字输出（与 DeepSeek 官方“思考中自动展开、完成后可折叠”的习惯一致）。
     */
    function ensureThinkingPanel() {
      if (thinkingPanelRef || !window.DSChatDemo) {
        return;
      }
      thinkingPanelRef = window.DSChatDemo.buildThinkingPanel("");
      thinkingPanelRef.classList.add("is-expanded"); // 生成过程中默认展开，完成后用户可自行收起
      thinkingContentEl = thinkingPanelRef.querySelector(".thinking-panel__content");
      col.insertBefore(thinkingPanelRef, bubble);
      if (window.DSIcons) {
        window.DSIcons.render(thinkingPanelRef);
      }
    }

    var sawAnyChunk = false;

    currentRequestHandle = window.DSApiClient.sendChatRequest({
      messages: buildApiMessages(messages),
      callbacks: {
        onContentChunk: function (chunk) {
          sawAnyChunk = true;
          assistantMsg.content += chunk;
          textSpan.textContent = assistantMsg.content;
          scrollToBottom();
        },
        onThinkingChunk: function (chunk) {
          sawAnyChunk = true;
          ensureThinkingPanel();
          assistantMsg.thinking += chunk;
          if (thinkingContentEl) {
            thinkingContentEl.textContent = assistantMsg.thinking;
          }
          scrollToBottom();
        },
        onDone: function (result) {
          // 非流式模式下，content/thinking 在此一次性到位；流式模式下这里的值与累积的一致，直接以最终结果为准
          assistantMsg.content = result.content || assistantMsg.content;
          assistantMsg.thinking = result.thinking || assistantMsg.thinking;
          if (assistantMsg.thinking && !thinkingPanelRef) {
            ensureThinkingPanel();
          }
          if (thinkingPanelRef && thinkingContentEl) {
            thinkingContentEl.textContent = assistantMsg.thinking;
            // 回复完成后，思考面板恢复默认收起态，与历史消息中的思考块展示习惯保持一致
            thinkingPanelRef.classList.remove("is-expanded");
          }
          finishRealReply(row, bubble, textSpan, cursor, assistantMsg, messages, replyParentId, false);
        },
        onError: function (error) {
          handleRealReplyError(error, row, bubble, textSpan, cursor, assistantMsg, messages, replyParentId, sawAnyChunk);
        }
      }
    });
  }

  /**
   * 真实请求成功结束：移除光标，走一次正式 Markdown 渲染，补上操作按钮栏，把这条回复
   * 挂到树上（appendToTree），不再是旧版本的"直接 push 进数组"。
   */
  function finishRealReply(row, bubble, textSpan, cursor, assistantMsg, messages, replyParentId, wasStopped) {
    if (cursor && cursor.parentNode) {
      cursor.parentNode.removeChild(cursor);
    }
    currentRequestHandle = null;

    var finalText = assistantMsg.content;
    var updatedMessages = messages;
    if (finalText && finalText.trim()) {
      appendToTree(currentConversationId, replyParentId, [assistantMsg]);
      updatedMessages = getMessages(currentConversationId);
    }

    var html = window.DSChatDemo ? window.DSChatDemo.renderMarkdown(finalText) : finalText;
    bubble.innerHTML = html;
    if (window.DSChatDemo) {
      window.DSChatDemo.renderMathFormulas(bubble);
      window.DSChatDemo.bindCodeCopyEvents(bubble);
    }

    if (finalText && finalText.trim() && window.DSChatDemo) {
      var actions = window.DSChatDemo.buildAssistantActionsBar(assistantMsg, row, {
        onRegenerate: handleRegenerate
      });
      row.querySelector(".message-col").appendChild(actions);
    }

    if (window.DSIcons) {
      window.DSIcons.render(row);
    }

    setGeneratingState(false);
    scrollToBottom();

    if (finalText && finalText.trim()) {
      syncSidebarAfterMessage(assistantMsg, updatedMessages);
      // 新回复可能让这条消息产生了兄弟版本（重新生成场景），刷新一次分支切换器徽标
      refreshBranchSwitcherForRow(row, assistantMsg.id);
    }
    refreshCompressStatusBar();

    if (wasStopped && window.DSToast) {
      window.DSToast.warning("已停止生成");
    }

    // 一轮回复（成功/停止/部分内容）彻底结束，立即落盘，不用等防抖
    persistConversationsNow();
  }

  /**
   * 统一处理真实请求过程中产生的各类错误，按错误类型展示对应中文 Toast 提示。
   * 若用户是主动点击“停止”导致的中断（ABORT 类型），不算错误，仅做收口处理，
   * 并保留已经流式输出的部分内容（而不是整条丢弃），贴近真实产品的“停止后保留已生成内容”预期。
   */
  function handleRealReplyError(error, row, bubble, textSpan, cursor, assistantMsg, messages, replyParentId, sawAnyChunk) {
    var ERR = window.DSApiClient.ERROR_TYPE;
    var type = error && error.dsErrorType;

    if (type === ERR.ABORT) {
      // 停止生成：保留已经输出的部分内容（若有），按“正常结束”流程收口
      if (error.dsExtra && typeof error.dsExtra.partialContent === "string") {
        assistantMsg.content = error.dsExtra.partialContent;
      }
      finishRealReply(row, bubble, textSpan, cursor, assistantMsg, messages, replyParentId, true);
      return;
    }

    // 其余错误类型：按分类展示对应中文提示
    var toastTextMap = {};
    toastTextMap[ERR.NETWORK] = error.message || "网络连接失败，请检查网络状况";
    toastTextMap[ERR.AUTH] = error.message || "密钥验证失败，请检查 API Key";
    toastTextMap[ERR.RATE_LIMIT] = error.message || "请求过于频繁，已被限流";
    toastTextMap[ERR.PARAM] = error.message || "请求参数有误";
    toastTextMap[ERR.SERVER] = error.message || "服务器发生异常";
    toastTextMap[ERR.TIMEOUT] = error.message || "请求超时";
    toastTextMap[ERR.CONFIG_MISSING] = error.message || "尚未配置 API 信息";
    toastTextMap[ERR.PARSE] = error.message || "响应解析失败";

    var finalMessage = toastTextMap[type] || error.message || "请求发生未知错误";
    if (window.DSToast) {
      window.DSToast.error(finalMessage);
    }

    currentRequestHandle = null;

    if (sawAnyChunk && assistantMsg.content) {
      // 边界处理：若已经收到了部分内容后才出错（例如流式过程中连接被重置），
      // 保留已输出内容作为一条不完整的回复，而不是整条丢弃，让用户至少能看到已生成的部分
      finishRealReply(row, bubble, textSpan, cursor, assistantMsg, messages, replyParentId, false);
      return;
    }

    // 完全没有收到任何内容就失败：移除这一整行占位（包括思考面板残影），不污染消息列表
    if (row && row.parentNode) {
      row.parentNode.removeChild(row);
    }
    setGeneratingState(false);
  }

  /**
   * 根据用户最新一条输入，从预置的模拟回复库中选取一段演示文本。
   * 规则很简单：按关键词粗略匹配，匹配不到则返回通用回复，用于让“模拟回复”显得不那么单一死板。
   * @param {string} userContent
   */
  function pickFakeReplyContent(userContent) {
    var text = (userContent || "").toLowerCase();
    if (/排序|算法/.test(text)) {
      return {
        thinking:
          "用户询问排序算法相关内容。需要按时间复杂度分类，覆盖常见的几种算法，\n" +
          "并给出简单的选型建议，避免过于学术化，保持回答的实用性。",
        content:
          "常见排序算法按时间复杂度可以分为三类：\n\n" +
          "- **O(n²)**：冒泡排序、选择排序、插入排序，实现简单但数据量大时效率较低\n" +
          "- **O(n log n)**：快速排序、归并排序、堆排序，综合性能较好，是实际工程中最常用的一类\n" +
          "- **O(n)**：计数排序、桶排序，仅适用于特定数据分布场景（如整数范围有限）\n\n" +
          "如果你的场景数据量较大且没有特殊分布特征，优先考虑快速排序或归并排序。"
      };
    }
    if (/python|代码|函数|写一个/.test(text)) {
      return {
        thinking:
          "用户需要代码示例。优先给出简洁、可直接运行的代码片段，并补充一句思路说明，\n" +
          "避免堆砌过多理论内容，保持回复的可操作性。",
        content:
          "这是一个简单的实现示例：\n\n" +
          "```python\n" +
          "def greet(name: str) -> str:\n" +
          "    return f\"你好，{name}！\"\n\n" +
          "print(greet(\"DeepSeek\"))\n" +
          "```\n\n" +
          "思路很直接：定义一个接收字符串参数的函数，返回拼接后的问候语。"
      };
    }
    return {
      thinking:
        "这是一条演示性的模拟回复：当前版本尚未接入真实模型 API，\n" +
        "所有回复内容均为本地预置文本，仅用于验证消息状态管理与流式渲染效果。",
      content:
        "收到你的消息了！当前是本地模拟回复阶段，还没有接入真实的 AI 接口，" +
        "所以这段文字是固定写死的演示内容，用来验证消息发送、流式输出、自动滚动等交互是否正常工作。"
    };
  }

  /**
   * 执行一次“模拟 AI 回复”的完整流程：选取回复文本 -> 替换加载行为流式气泡 -> 逐字输出。
   * @param {HTMLElement|null} loadingRow 要被替换掉的加载占位行（可能为 null，异常兜底）
   * @param {Array} messages 当前对话"可见路径"的只读消息数组（供关键词匹配用）
   * @param {string} userContent 本轮触发回复的用户输入（用于简单关键词匹配选择演示文案）
   * @param {string|null} replyParentId 完成后把这条回复挂到树上的父节点 id
   */
  function runFakeAssistantReply(loadingRow, messages, userContent, replyParentId) {
    var picked = pickFakeReplyContent(userContent);
    var assistantMsg = {
      id: generateMessageId("a"),
      role: "assistant",
      thinking: picked.thinking,
      content: "" // 初始为空，流式过程中逐步填充，完成后写入完整文本
    };

    // 构建流式展示专用的临时 DOM 结构：思考面板（如有）+ 纯文本容器 + 跳动光标
    var row = document.createElement("div");
    row.className = "message-row message-row--assistant";
    row.dataset.id = assistantMsg.id;
    var col = document.createElement("div");
    col.className = "message-col";

    if (assistantMsg.thinking && window.DSChatDemo) {
      col.appendChild(window.DSChatDemo.buildThinkingPanel(assistantMsg.thinking));
    }

    var bubble = document.createElement("div");
    bubble.className = "message-bubble markdown-body";
    var textSpan = document.createElement("span");
    bubble.appendChild(textSpan);
    var cursor = document.createElement("span");
    cursor.className = "stream-cursor";
    bubble.appendChild(cursor);
    col.appendChild(bubble);
    row.appendChild(col);

    if (loadingRow && loadingRow.parentNode) {
      loadingRow.parentNode.replaceChild(row, loadingRow);
    } else if (el.messageList) {
      el.messageList.appendChild(row);
    }
    if (window.DSIcons) {
      window.DSIcons.render(col);
    }

    var fullText = picked.content;
    var index = 0;
    var CHAR_INTERVAL_MS = 16; // 逐字渲染间隔（毫秒），setTimeout 分帧执行，不阻塞主线程

    function appendNextChar() {
      if (!isGenerating) {
        // 用户点击了“停止”：按当前已输出的部分收口
        finishFakeReply(row, bubble, textSpan, cursor, assistantMsg, messages, replyParentId, fullText.slice(0, index), true);
        return;
      }
      if (index >= fullText.length) {
        finishFakeReply(row, bubble, textSpan, cursor, assistantMsg, messages, replyParentId, fullText, false);
        return;
      }
      index += 1;
      textSpan.textContent = fullText.slice(0, index);
      scrollToBottom();
      streamTimer = setTimeout(appendNextChar, CHAR_INTERVAL_MS);
    }

    appendNextChar();
  }

  /**
   * 结束一次模拟流式回复：把最终文本挂到树上（appendToTree），正式走一次 Markdown 渲染，
   * 补上操作按钮栏，并恢复发送按钮状态。
   */
  function finishFakeReply(row, bubble, textSpan, cursor, assistantMsg, messages, replyParentId, finalText, wasStopped) {
    if (cursor && cursor.parentNode) {
      cursor.parentNode.removeChild(cursor);
    }

    assistantMsg.content = finalText;
    var updatedMessages = messages;
    // 只有真正产生了内容才写入消息树，避免“一开始就被停止、内容为空”的消息污染历史记录（边界处理）
    if (finalText.trim()) {
      appendToTree(currentConversationId, replyParentId, [assistantMsg]);
      updatedMessages = getMessages(currentConversationId);
    }

    var html = window.DSChatDemo ? window.DSChatDemo.renderMarkdown(finalText) : finalText;
    bubble.innerHTML = html;
    if (window.DSChatDemo) {
      window.DSChatDemo.renderMathFormulas(bubble);
      window.DSChatDemo.bindCodeCopyEvents(bubble);
    }

    if (finalText.trim() && window.DSChatDemo) {
      var actions = window.DSChatDemo.buildAssistantActionsBar(assistantMsg, row, {
        onRegenerate: handleRegenerate
      });
      row.querySelector(".message-col").appendChild(actions);
    }

    if (window.DSIcons) {
      window.DSIcons.render(row);
    }

    setGeneratingState(false);
    scrollToBottom();

    // 回复完成后，再次同步侧边栏预览文本为 AI 的回复内容（更贴近“最后一条消息”的真实含义）
    if (finalText.trim()) {
      syncSidebarAfterMessage(assistantMsg, updatedMessages);
      refreshBranchSwitcherForRow(row, assistantMsg.id);
    }
    refreshCompressStatusBar();

    if (wasStopped && window.DSToast) {
      window.DSToast.warning("已停止生成");
    }

    // 一轮模拟回复彻底结束，立即落盘，不用等防抖
    persistConversationsNow();
  }

  /**
   * 停止当前生成：
   * - 若当前是真实 API 请求（currentRequestHandle 存在），调用其 abort() 中断底层网络连接，
   *   真实的收口逻辑（保留已输出部分内容）由 handleRealReplyError 的 ABORT 分支统一处理。
   * - 若当前是本地模拟回复（streamTimer 存在），清除定时器，isGenerating 置为 false 后，
   *   正在运行的 appendNextChar 下一次调度时会检测到并收口当前已输出内容。
   */
  function stopGenerating() {
    if (currentRequestHandle) {
      currentRequestHandle.abort();
      // 不在此处立即 setGeneratingState(false)：真实请求的 abort 是异步生效的，
      // 按钮状态恢复统一交给 handleRealReplyError -> finishRealReply 收口时处理，
      // 避免出现“按钮已变回发送态，但请求其实还没真正断开”的状态不一致。
      return;
    }
    // 边界处理：这一轮请求还处在"自动压缩"阶段，真实请求尚未发出
    // （currentRequestHandle 还没被赋值），此时点停止要让 maybeAutoCompact
    // 的 then 回调识别出本轮已失效，不再继续发起真实请求
    currentGeneratingToken += 1;
    if (streamTimer) {
      clearTimeout(streamTimer);
      streamTimer = null;
    }
    isGenerating = false;
    setGeneratingState(false);
  }

  // ================================================================
  // 消息操作：编辑用户消息并重发 / 重新生成 AI 回复 / 清空当前对话
  // ================================================================

  /**
   * 处理“编辑用户消息”：把气泡替换为可编辑文本框，保存后：
   *   1. 更新该消息在状态数组中的内容
   *   2. 删除其之后的所有消息（因为上下文已经改变，旧的后续回复不再有效）
   *   3. 重新渲染整个对话，并基于新内容重新触发一次模拟 AI 回复
   * 这是贴近真实产品逻辑的“编辑重发”行为：编辑一条历史消息相当于从那个时间点重新继续对话。
   */
  function handleEditUserMessage(msg, rowEl) {
    if (isGenerating) {
      if (window.DSToast) {
        window.DSToast.warning("正在生成回复，请先停止后再编辑");
      }
      return;
    }
    var col = rowEl.querySelector(".message-col");
    var bubble = rowEl.querySelector(".message-bubble");
    var actions = rowEl.querySelector(".message-actions");
    var switcher = rowEl.querySelector(".branch-switcher");
    if (!col || !bubble || !window.DSChatDemo) {
      return;
    }

    bubble.style.display = "none";
    if (actions) {
      actions.style.display = "none";
    }
    if (switcher) {
      switcher.style.display = "none";
    }

    var editBox = window.DSChatDemo.buildEditBox(
      msg.content,
      function onSave(newText) {
        applyEditAndResend(msg, newText);
      },
      function onCancel() {
        editBox.parentNode.removeChild(editBox);
        bubble.style.display = "";
        if (actions) {
          actions.style.display = "";
        }
        if (switcher) {
          switcher.style.display = "";
        }
      }
    );
    col.insertBefore(editBox, bubble);
    editBox.__textarea.focus();
    editBox.__textarea.setSelectionRange(editBox.__textarea.value.length, editBox.__textarea.value.length);
  }

  /**
   * 应用编辑结果：截断该消息之后的历史，更新内容，重新渲染并重新触发一次 AI 回复。
   */
  /**
   * 应用编辑结果：真实的"分支"行为（移植自官方 editMessage()）——
   * 不截断、不覆盖原消息，而是在"被编辑消息的父节点"下挂一条新的
   * 用户消息+AI回复分支；原来那条消息及其所有后续对话（包括旧回答）
   * 原样保留在树里，不会丢失，用户可以通过分支切换器随时切回去看。
   */
  function applyEditAndResend(msg, newText) {
    // 先记住"编辑前这条分支"的叶子 id，等新分支挂上去之后用它来作废旧记录——
    // 新分支是另一条路径（不同的叶子 id），天然不会和旧分支的压缩记录冲突，
    // 但旧分支这条记录既然已经不会再被用到（编辑产生了新的当前路径），清理掉它。
    var oldLeafId = getCurrentLeafId(currentConversationId);
    var tree = getConversationTree(currentConversationId);
    var original = tree.messages.find(function (m) {
      return m.id === msg.id;
    });
    if (!original) {
      return;
    }
    var newUserMsg = {
      id: generateMessageId("u"),
      role: "user",
      content: newText,
      files: Array.isArray(original.files) ? original.files : []
    };
    // 新分支挂在原消息的父节点下（和原消息做兄弟），不是挂在原消息下面——
    // 这样新旧两条问题是平级的"同一个问题的两个版本"，而不是一问一答的父子关系
    appendToTree(currentConversationId, original.parentId === undefined ? null : original.parentId, [newUserMsg]);
    // 编辑改变了"当前这条分支"的历史结构，原有的压缩摘要（如果存在）已经不能
    // 准确代表新的对话内容，必须作废；旧分支本身（切回去看）的压缩记录不受影响
    invalidateCompressionRecord(currentConversationId, oldLeafId);
    persistConversationsNow();

    renderConversation();
    var messages = getMessages(currentConversationId);
    syncSidebarAfterMessage(newUserMsg, messages);

    // 插入加载行并重新触发一次 AI 回复，模拟“编辑后重新发送”的真实效果
    var loadingRowId = "loading-row-" + Date.now();
    var loadingRow = window.DSChatDemo ? window.DSChatDemo.buildLoadingMessage(loadingRowId) : null;
    if (loadingRow) {
      el.messageList.appendChild(loadingRow);
      scrollToBottom(true);
    }
    setGeneratingState(true);
    triggerAssistantReply(loadingRow, messages, newText, newUserMsg.id);

    if (window.DSToast) {
      window.DSToast.success("已更新消息，正在重新生成回复");
    }
  }

  /**
   * 处理“重新生成”：真实的"分支"行为（移植自官方 regenerateReply()）——
   * 不删除旧回答，而是在"触发这条回答的用户消息"下面挂一条新的 AI 回复分支，
   * 新旧两条回答成为兄弟版本，用户可以通过分支切换器随时切换查看。
   * 该用户消息之后、原本属于旧回答这条分支的后续对话不受影响，仍挂在旧分支下。
   */
  function handleRegenerate(msg, rowEl) {
    if (isGenerating) {
      if (window.DSToast) {
        window.DSToast.warning("正在生成中，请先停止当前生成");
      }
      return;
    }
    var tree = getConversationTree(currentConversationId);
    var originalReply = tree.messages.find(function (m) {
      return m.id === msg.id;
    });
    if (!originalReply || originalReply.parentId === undefined || originalReply.parentId === null) {
      return;
    }
    var precedingUserMsg = tree.messages.find(function (m) {
      return m.id === originalReply.parentId;
    });
    if (!precedingUserMsg) {
      return;
    }
    // 重新生成会让"当前这条路径"的叶子变成新回复，旧路径（当前这个叶子 id）
    // 对应的压缩记录不会再被用到，清理掉；新路径有自己的叶子 id，独立判断要不要压缩
    invalidateCompressionRecord(currentConversationId, getCurrentLeafId(currentConversationId));
    persistConversationsNow();

    var loadingRowId = "loading-row-" + Date.now();
    var loadingRow = window.DSChatDemo ? window.DSChatDemo.buildLoadingMessage(loadingRowId) : null;
    // 直接替换这条 AI 消息所在的 DOM 行为加载态——分支切换只影响树的指针，
    // 还没有新回复落地前，不需要整体重绘消息列表，保持原有的"增量 DOM 更新"习惯。
    if (rowEl && rowEl.parentNode && loadingRow) {
      rowEl.parentNode.replaceChild(loadingRow, rowEl);
      scrollToBottom(true);
    }
    setGeneratingState(true);
    // 新回复挂在同一个父节点（precedingUserMsg.id）下面，成为旧回复的兄弟分支
    triggerAssistantReply(loadingRow, getMessages(currentConversationId), precedingUserMsg.content, precedingUserMsg.id);

    if (window.DSToast) {
      window.DSToast.success("正在重新生成回复");
    }
  }

  /**
   * 清空当前对话的全部消息（二次确认后执行）。
   * 仅清空内存中的消息状态与聊天区 DOM，不影响侧边栏对话本身是否存在（对话条目仍保留，只是变为空对话）。
   */
  function handleClearCurrentConversation() {
    if (!currentConversationId) {
      if (window.DSToast) {
        window.DSToast.warning("当前没有可清空的对话");
      }
      return;
    }
    var messages = getMessages(currentConversationId);
    if (!messages.length) {
      if (window.DSToast) {
        window.DSToast.warning("当前对话没有消息");
      }
      return;
    }
    window.DSConfirm
      .show({
        title: "清空当前对话",
        message: "将清空本对话中的全部消息记录，且无法恢复，确定要继续吗？",
        confirmText: "清空",
        danger: true
      })
      .then(function (ok) {
        if (!ok) {
          return;
        }
        if (isGenerating) {
          stopGenerating();
        }
        setConversationTree(currentConversationId, { messages: [], rootMessageId: null });
        // 清空对话影响的是全部分支（所有消息都没了），不是某一条分支，
        // 要把这个对话名下所有分支的压缩记录一并清掉，而不是只清当前这一条
        if (window.DSCompressionRecords) {
          window.DSCompressionRecords.clearAllRecordsForConversation(currentConversationId);
        }
        renderConversation();
        if (window.DSSidebar && typeof window.DSSidebar.updateConversationPreview === "function") {
          window.DSSidebar.updateConversationPreview(currentConversationId, "");
        }
        persistConversationsNow();
        if (window.DSToast) {
          window.DSToast.success("已清空当前对话");
        }
      });
  }

  // ================================================================
  // 与侧边栏模块的联动
  // ================================================================

  /**
   * 发送/接收消息后，同步更新侧边栏列表中该对话的「最后一条消息预览」与「更新时间」，
   * 并在这是对话的第一条用户消息时，依据内容自动生成一个简短标题。
   * @param {Object} latestMsg 刚刚产生的消息对象
   * @param {Array} messages 当前完整消息数组
   */
  function syncSidebarAfterMessage(latestMsg, messages) {
    if (!window.DSSidebar || !currentConversationId) {
      return;
    }
    var PREVIEW_MAX_LENGTH = 36;
    var preview = (latestMsg.content || "").replace(/\s+/g, " ").trim();
    if (preview.length > PREVIEW_MAX_LENGTH) {
      preview = preview.slice(0, PREVIEW_MAX_LENGTH) + "…";
    }
    window.DSSidebar.updateConversationPreview(currentConversationId, preview);

    // 自动生成标题：仅当该对话还是默认的“新对话”标题、且这是第一条用户消息时触发
    var firstUserMsg = messages.find(function (m) {
      return m.role === "user";
    });
    var conv = window.DSSidebar.getActiveConversation();
    if (conv && firstUserMsg && latestMsg.id === firstUserMsg.id && (conv.title === "新对话" || !conv.title)) {
      var TITLE_MAX_LENGTH = 20;
      var title = (firstUserMsg.content || "").replace(/\s+/g, " ").trim();
      if (title.length > TITLE_MAX_LENGTH) {
        title = title.slice(0, TITLE_MAX_LENGTH) + "…";
      }
      if (title) {
        window.DSSidebar.updateConversationTitle(currentConversationId, title);
      }
    }
  }

  /**
   * 侧边栏「对话切换」回调：更新当前对话 id，加载该对话的历史消息（若首次访问），
   * 并重新渲染消息列表。若用户正在生成中途切换了对话，先停止当前生成，避免跨对话污染。
   * @param {Object|null} conv 新的当前对话对象（可能为 null，表示没有任何对话）
   */
  function handleSidebarConversationChange(conv) {
    if (isGenerating) {
      stopGenerating();
    }
    currentConversationId = conv ? conv.id : null;
    ensureConversationLoaded(conv);
    renderConversation();
    // 切换会话后，联动刷新聊天区背景图层为该会话各自保存的背景（可能是无背景）
    if (window.DSSettings && typeof window.DSSettings.applyBackgroundToChatArea === "function") {
      window.DSSettings.applyBackgroundToChatArea(currentConversationId);
    }
  }

  /**
   * 强制用一份"刚从 IndexedDB 异步加载回来的真实对话数据"整体替换内存里的消息状态。
   * 用途：应用启动时 sidebar.js 先用演示数据同步渲染出界面（保证不等待、不白屏），
   * 随后异步读取 IndexedDB，如果读到了真实保存过的对话，就调用本函数把演示数据
   * 替换成真实数据——这是唯一允许"覆盖已存在的 conversationTrees[id]"的入口，
   * 日常的 ensureConversationLoaded 不会覆盖已经加载过的内容（保护用户当次会话里
   * 正在编辑的内容不被意外重置）。每个对话的 messages 同样用 normalizeSession
   * 规范化，兼容"历史是旧的线性数组、还没有分支字段"的情况。
   * @param {Array} conversations 完整对话数组，每个对话对象带 messages 字段
   * @param {string|null} activeId 加载完成后应该显示的当前对话 id
   */
  function reloadAllFromConversations(conversations, activeId) {
    conversationTrees = {};
    (conversations || []).forEach(function (conv) {
      var rawMessages = Array.isArray(conv.messages) ? JSON.parse(JSON.stringify(conv.messages)) : [];
      conversationTrees[conv.id] = window.DSBranches.normalizeSession(rawMessages, conv.rootMessageId);
    });
    currentConversationId = activeId || null;
    renderConversation();
    if (window.DSSettings && typeof window.DSSettings.applyBackgroundToChatArea === "function") {
      window.DSSettings.applyBackgroundToChatArea(currentConversationId);
    }
  }

  function bindScrollBottomButton() {
    if (!el.messageList || !el.btnScrollBottom) {
      return;
    }
    el.messageList.addEventListener("scroll", handleMessageListScroll);
    el.btnScrollBottom.addEventListener("click", function () {
      autoScrollPaused = false;
      scrollToBottom(true);
    });
    updateScrollBottomButton();
  }

  // 压缩阶段 -> 展示文案映射（真实阶段文字，不做虚假百分比进度条），
  // 顶部按钮与设置面板的"立即压缩"按钮共用同一份映射，保持措辞一致。
  var COMPRESS_STAGE_LABEL = {
    selecting: "正在选取范围…",
    summarizing: "正在生成摘要…",
    verifying: "正在校验结果…"
  };

  // 当前是否有一次由 triggerManualCompress 发起的手动压缩正在进行、它对应的对话 id，
  // 供多个 UI 入口（顶部按钮、设置面板按钮）共享同一次压缩请求的状态，
  // 避免用户在顶部点了压缩、又跑去设置面板再点一次，导致重复请求。
  var manualCompressInFlightConvId = null;

  /**
   * 手动触发一次对当前对话的压缩（真实接入 js/core/compression.js，force: true
   * 跳过压力阈值判断，用户主动点击就应该立刻执行）。
   * 这是顶部「压缩上下文」按钮与设置面板「立即压缩当前对话」按钮共用的核心逻辑，
   * 两处 UI 只是各自提供不同的 onProgress 展示方式（按钮文案 / 进度卡片）。
   * 【不会删除或替换任何聊天记录】成功后只会写入一份压缩记录
   * （js/core/compression-records.js），原始消息数组、页面上的气泡、
   * 已持久化的历史完全不受影响；真正的"省 token"效果发生在下一次真正
   * 发送请求时的 buildApiMessages 组装阶段。
   * @param {Object} [handlers] { onProgress(stage, detail), onSettled() }
   *   onSettled 在压缩成功/跳过/失败任一结果后都会调用一次，供 UI 收尾复位
   *   （例如停止计时器、恢复按钮可点击），参数与 onProgress 无关。
   */
  function triggerManualCompress(handlers) {
    handlers = handlers || {};
    var onProgress = typeof handlers.onProgress === "function" ? handlers.onProgress : function () {};
    var onSettled = typeof handlers.onSettled === "function" ? handlers.onSettled : function () {};

    // 下面每一个提前 return 的分支都要先调用 onSettled(true)——调用方（按钮 UI）
    // 已经在调用本函数之前就切到了"压缩中"的视觉状态（计时器、禁用、旋转图标等），
    // 如果某个校验没通过导致函数提前退出却不通知 onSettled，按钮会永久卡在
    // "压缩中"外观上，用户看起来就是"点了没反应、卡死了"。
    if (!window.DSCompression || !window.DSCompressionSettings) {
      onSettled(true);
      if (window.DSToast) {
        window.DSToast.error("压缩引擎未加载");
      }
      return;
    }
    if (!currentConversationId) {
      onSettled(true);
      if (window.DSToast) {
        window.DSToast.warning("请先选择一个对话");
      }
      return;
    }
    if (window.DSCompression.isCompacting(currentConversationId) || manualCompressInFlightConvId === currentConversationId) {
      onSettled(true);
      if (window.DSToast) {
        window.DSToast.warning("当前对话正在压缩中，请稍候");
      }
      return;
    }
    if (!window.DSUserConfig || !window.DSUserConfig.isApiConfigReady()) {
      onSettled(true);
      if (window.DSToast) {
        window.DSToast.warning("压缩摘要需要调用模型，请先在设置中配置 API 地址与模型名称");
      }
      return;
    }

    // 边界处理：记住发起压缩时的对话 id——压缩请求通常要花几秒，
    // 这期间用户完全可以切换到别的对话；messages 数组引用始终指向
    // "发起压缩那一刻"的那个对话，数据替换本身永远是正确的，
    // 但只有当用户还停留在同一个对话时，才应该立即重绘画面，
    // 否则会出现"正在看对话 A，却突然被对话 B 的压缩结果重绘"的错位。
    var targetConversationId = currentConversationId;
    var messages = getMessages(targetConversationId);
    if (messages.length === 0) {
      onSettled(true);
      if (window.DSToast) {
        window.DSToast.warning("当前对话没有内容可以压缩");
      }
      return;
    }

    var cfg = window.DSCompressionSettings.getConfig();
    manualCompressInFlightConvId = targetConversationId;
    // 记住"手动压缩的是哪条分支"，与自动压缩钩子同理
    var leafId = messages[messages.length - 1].id;

    window.DSCompression
      .compactConversation(
        targetConversationId,
        messages,
        Object.assign({}, cfg, {
          force: true,
          onProgress: function (stage, detail) {
            onProgress(stage, detail, targetConversationId === currentConversationId);
          }
        })
      )
      .then(function (result) {
        manualCompressInFlightConvId = null;
        var stillActive = targetConversationId === currentConversationId;
        onSettled(stillActive);
        if (result.compacted) {
          // 只写压缩记录，不触碰原始消息数组、不需要重绘——聊天记录本身一个字都没变，
          // 页面上看到的还是完整原文，压缩只会在下一次真正发送请求时悄悄生效
          if (window.DSCompressionRecords) {
            window.DSCompressionRecords.setRecord(targetConversationId, leafId, {
              shadowedMessageIds: result.shadowedMessageIds,
              summary: result.summary
            });
          }
          if (window.DSToast) {
            window.DSToast.success(
              (stillActive ? "摘要已生成：" : "另一个对话的摘要已在后台生成：") +
                result.shadowedCount + " 条旧消息已可用摘要代替，聊天记录完整保留，下一轮发送自动精简上下文"
            );
          }
        } else if (window.DSToast && stillActive) {
          window.DSToast.warning("当前对话内容较短，暂时不需要压缩");
        }
      })
      .catch(function (err) {
        manualCompressInFlightConvId = null;
        onSettled(targetConversationId === currentConversationId);
        console.error("[DSChat] 手动压缩失败：", err);
        if (window.DSToast) {
          window.DSToast.error("压缩失败：" + (err && err.message ? err.message : "未知错误"));
        }
      });
  }

  /**
   * 顶部「压缩上下文」按钮：UI 层包装，调用共享的 triggerManualCompress。
   * 按钮本身只保留"禁用 + 图标旋转"这两个轻量视觉反馈；真正的阶段文字
   * （按真实阶段切换 + 每秒刷新已用时长 + 流式时的实时字数）展示在压缩状态条
   * 的进度区域（对话界面顶部，不用跳设置面板），压缩状态条与顶部按钮共用同一次
   * triggerManualCompress 调用产生的进度回调。
   */
  function bindCompressButton() {
    if (!el.btnCompressContext) {
      return;
    }
    var elapsedTimer = null;
    var startedAt = 0;
    var latestStage = "";
    var latestStreamedChars = 0;

    function renderProgressBar() {
      if (!el.compressStatusBarProgressText) {
        return;
      }
      var elapsedSec = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
      var stageLabel = COMPRESS_STAGE_LABEL[latestStage] || "正在压缩…";
      var streamedPart = latestStreamedChars > 0 ? "（已生成 " + latestStreamedChars + " 字）" : "";
      el.compressStatusBarProgressText.textContent = stageLabel + streamedPart + " · 已用 " + elapsedSec + "s";
    }

    function startCompressingUi() {
      startedAt = Date.now();
      latestStage = "selecting";
      latestStreamedChars = 0;
      el.btnCompressContext.disabled = true;
      el.btnCompressContext.classList.add("is-compressing");
      if (el.compressStatusBar) {
        el.compressStatusBar.hidden = false;
      }
      if (el.compressStatusBarProgress) {
        el.compressStatusBarProgress.hidden = false;
      }
      if (el.compressStatusBarInfo) {
        el.compressStatusBarInfo.style.display = "none";
      }
      renderProgressBar();
      elapsedTimer = setInterval(renderProgressBar, 1000);
    }

    function stopCompressingUi() {
      if (elapsedTimer) {
        clearInterval(elapsedTimer);
        elapsedTimer = null;
      }
      el.btnCompressContext.disabled = false;
      el.btnCompressContext.classList.remove("is-compressing");
      if (el.compressStatusBarProgress) {
        el.compressStatusBarProgress.hidden = true;
      }
      if (el.compressStatusBarInfo) {
        el.compressStatusBarInfo.style.display = "";
      }
      refreshCompressStatusBar();
    }

    el.btnCompressContext.addEventListener("click", function () {
      startCompressingUi();
      triggerManualCompress({
        onProgress: function (stage, detail, stillActive) {
          // 压缩期间用户切换了对话：状态条此刻展示的是"当前对话"的状态，
          // 不应该被另一个已经不在眼前的对话的进度覆盖
          if (!stillActive) {
            return;
          }
          latestStage = stage;
          if (detail && typeof detail.streamedChars === "number") {
            latestStreamedChars = detail.streamedChars;
          }
          renderProgressBar();
        },
        onSettled: function (stillActive) {
          if (stillActive) {
            stopCompressingUi();
          }
        }
      });
    });
  }

  // ================================================================
  // 初始化
  // ================================================================
  function init() {
    cacheDom();

    // 订阅侧边栏的对话切换事件，实现“切换对话 -> 聊天区联动加载对应历史消息”
    if (window.DSSidebar && typeof window.DSSidebar.onConversationChange === "function") {
      window.DSSidebar.onConversationChange(handleSidebarConversationChange);
    }

    // 首次加载：取侧边栏当前已选中的对话，初始化消息状态并渲染
    var initialConv = window.DSSidebar ? window.DSSidebar.getActiveConversation() : null;
    currentConversationId = initialConv ? initialConv.id : null;
    ensureConversationLoaded(initialConv);
    renderConversation();

    bindScrollBottomButton();
    bindCompressButton();

    if (el.btnClearCurrentChat) {
      el.btnClearCurrentChat.addEventListener("click", handleClearCurrentConversation);
    }

    console.log("[DSChat] 初始化完成（Step 5：已对接通用 API 适配层，未配置时自动降级为本地模拟回复）。");
  }

  window.DSChat = {
    init: init,
    sendUserMessage: sendUserMessage,
    stopGenerating: stopGenerating,
    isGenerating: isCurrentlyGenerating,
    clearCurrentConversation: handleClearCurrentConversation,
    /**
     * 供持久化模块（js/modules/sidebar/sidebar.js 的 persistNow）读取指定对话当前的
     * 完整消息数组（含全部分支的所有节点，不是只有当前可见路径），用于拼装
     * "要保存进 IndexedDB 的完整快照"——必须存全部分支，否则刷新页面后
     * 切换到别的分支的历史就会丢失，分支功能就只是"当次会话内有效"的假把式。
     * 返回内存中数组的直接引用即可——保存时会被 JSON 序列化，不会被意外修改。
     * @param {string} conversationId
     * @returns {Array}
     */
    getMessagesSnapshot: function (conversationId) {
      return getConversationTree(conversationId).messages;
    },
    /**
     * 供持久化模块读取指定对话当前的根节点 id，随 messages 一起存进
     * IndexedDB，下次加载时 normalizeSession 据此判断"这是不是已经规范化过的树"。
     * @param {string} conversationId
     * @returns {string|null|undefined}
     */
    getRootMessageId: function (conversationId) {
      return getConversationTree(conversationId).rootMessageId;
    },
    /**
     * 供压缩引擎、token 统计、设置面板等只关心"当前显示给用户看的那条线性历史"的
     * 外部模块调用——与内部的 getMessages 是同一份逻辑，区别只是对外暴露的命名
     * 更明确（"可见路径"而不是容易被误解为"全部消息"的名字）。
     * @param {string} conversationId
     * @returns {Array}
     */
    getVisibleMessages: function (conversationId) {
      return getMessages(conversationId);
    },
    // 供 sidebar.js 在"异步从 IndexedDB 加载到真实历史数据"后调用，整体替换演示数据
    reloadAllFromConversations: reloadAllFromConversations,
    // 供设置面板「对话压缩」Tab 的"立即压缩当前对话"按钮调用，与顶部压缩按钮
    // 共用同一套压缩逻辑，只是各自提供不同的 onProgress/onSettled 展示方式
    triggerManualCompress: triggerManualCompress
  };
})();
