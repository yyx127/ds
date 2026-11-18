/**
 * ============================================================
 * sidebar.js —— 侧边栏交互模块（现已接入真实 IndexedDB 持久化）
 * ============================================================
 * 职责范围：
 *   1. 渲染对话列表（标题、预览、时间、置顶分组）
 *   2. hover 显示操作按钮：重命名、置顶/取消置顶、删除
 *   3. 点击列表项切换「当前选中对话」高亮状态
 *   4. 点击新建对话：插入一条空白对话到列表最前并选中
 *   5. 点击删除：二次确认后从数组中移除
 *   6. 侧边栏展开/收起（桌面端），移动端抽屉式打开/关闭
 *   7. 搜索框过滤对话列表（纯前端按标题/预览文本过滤）
 *   8. 持久化：启动时先同步渲染 mock-data.js 的演示数据（保证不等待任何
 *      异步 IO 就能看到界面），随后异步从 IndexedDB 读取之前真实保存过的
 *      对话数据，如果存在就整体替换掉演示数据；新建/删除/清空/重命名/置顶
 *      等任何会改变数据的操作之后都会调用 persistNow() 触发保存
 *      （真正的读写逻辑在 js/core/conversation-store.js）
 *
 * 【导入导出】「导出单条对话 JSON」「导入对话 JSON」仍是占位思路，尚未实现，
 * 留给后续独立的历史导入导出 Step。
 * ============================================================
 */

(function () {
  "use strict";

  // ---------------- 模块内状态 ----------------
  // 当前内存中的对话列表（Step 2 阶段为假数据，之后 Step 会替换为从存储层异步加载）
  var conversations = [];
  // 当前选中（高亮）的对话 id
  var activeId = null;
  // 当前搜索关键词（用于过滤列表）
  var searchKeyword = "";
  // 侧边栏是否处于收起态（桌面端）
  var isCollapsed = false;
  // 对话切换/新建/删除/清空时的外部订阅回调列表（供聊天区模块订阅，解耦侧边栏与聊天区的直接依赖）
  var conversationChangeListeners = [];

  // ---------------- DOM 引用（在 init 中统一获取，避免 Step 1 main.js 尚未执行时取不到节点） ----------------
  var el = {};

  function cacheDom() {
    el.sidebar = document.getElementById("sidebar");
    el.overlay = document.getElementById("sidebar-overlay");
    el.btnCollapse = document.getElementById("btn-collapse-sidebar");
    el.btnNewChat = document.getElementById("btn-new-chat");
    el.searchInput = document.getElementById("input-search-conv");
    el.list = document.getElementById("conversation-list");
    el.emptyAll = document.getElementById("conversation-list-empty");
    el.emptySearch = document.getElementById("conversation-list-empty-search");
    el.btnClearAll = document.getElementById("btn-clear-all");
    el.btnOpenSidebarMobile = document.getElementById("btn-open-sidebar-mobile");
    el.mainHeaderTitle = document.getElementById("main-header-title");
  }

  /**
   * 判断当前是否处于「移动端断点」内（与 responsive.css 的 768px 断点保持一致）。
   * 用于区分「收起/展开」在桌面端和移动端的不同语义（桌面端=变图标条，移动端=抽屉开关）。
   */
  function isMobileViewport() {
    return window.matchMedia("(max-width: 768px)").matches;
  }

  // ================================================================
  // 数据层：加载、过滤、增删改
  // ================================================================

  /**
   * 同步加载演示数据（mock-data.js）。应用启动的第一步永远先用这份数据同步渲染出界面，
   * 保证打开页面不需要等待任何异步 IO 就能看到完整 UI；
   * 真实的本地历史数据改由 loadPersistedConversationsAsync 异步加载，加载完成后
   * （如果确实存在）再整体替换掉这里的演示数据。
   */
  function loadMockConversations() {
    if (window.DSMockData && typeof window.DSMockData.getMockConversations === "function") {
      conversations = window.DSMockData.getMockConversations();
    } else {
      // 边界处理：假数据模块未加载时，退化为空列表，不影响页面其余功能
      console.warn("[DSSidebar] 未检测到 window.DSMockData，对话列表将以空列表启动。");
      conversations = [];
    }
    // 默认选中列表中最新的一条（若存在），模拟“进入应用时自动打开最近对话”的常见体验
    if (conversations.length > 0) {
      activeId = getSortedConversations()[0].id;
    }
  }

  /**
   * 异步从 IndexedDB 读取之前保存过的真实对话数据（见 js/core/conversation-store.js）。
   * 如果读到了（说明用户之前用过本应用、保存过真实对话），整体替换掉刚才同步加载的
   * 演示数据，重绘侧边栏列表，并通知 chat.js 用真实数据整体替换内存里的消息状态；
   * 如果读不到（全新用户首次打开，或存储层异常），什么都不做，继续使用演示数据，
   * 这样首次使用的人依然能看到一个"看起来有内容"的界面，不会一打开就是完全空白。
   */
  function loadPersistedConversationsAsync() {
    if (!window.DSConversationStore || typeof window.DSConversationStore.load !== "function") {
      return;
    }
    window.DSConversationStore.load().then(function (persisted) {
      if (!persisted || persisted.length === 0) {
        return;
      }
      conversations = persisted;
      activeId = conversations.length > 0 ? getSortedConversations()[0].id : null;
      renderList();
      if (el.mainHeaderTitle) {
        var activeConv = activeId ? findConversation(activeId) : null;
        el.mainHeaderTitle.textContent = activeConv ? activeConv.title : "新对话";
      }
      if (window.DSChat && typeof window.DSChat.reloadAllFromConversations === "function") {
        window.DSChat.reloadAllFromConversations(conversations, activeId);
      }
      console.log("[DSSidebar] 已从本地存储恢复 " + conversations.length + " 个对话，演示数据已替换。");
    });
  }

  /**
   * 构建"当前完整对话数据快照"（供持久化模块写入 IndexedDB 用）：
   * 把 sidebar.js 自己维护的对话元数据（标题/置顶/预览/时间等）与 chat.js 维护的
   * 每个对话的消息树（全部分支节点 + rootMessageId）合并成一份完整数据。
   * 两份数据分别由两个模块各自管理，只在"要保存"的这一刻临时合并，
   * 不互相持有对方的内部状态引用。消息树必须整棵保存（不是只存当前可见路径），
   * 否则刷新页面后切到别的分支看到的历史就会丢失。
   */
  function buildPersistSnapshot() {
    return conversations.map(function (conv) {
      var messages = window.DSChat && typeof window.DSChat.getMessagesSnapshot === "function"
        ? window.DSChat.getMessagesSnapshot(conv.id)
        : conv.messages || [];
      var rootMessageId = window.DSChat && typeof window.DSChat.getRootMessageId === "function"
        ? window.DSChat.getRootMessageId(conv.id)
        : conv.rootMessageId;
      var snapshot = Object.assign({}, conv, { messages: messages });
      // rootMessageId 可能是 undefined（线性历史，未规范化），显式赋值而不是用
      // Object.assign 的方式带过去，确保 undefined 也会覆盖掉 conv 上可能存在的旧值
      snapshot.rootMessageId = rootMessageId;
      return snapshot;
    });
  }

  /**
   * 触发一次持久化保存。
   * @param {boolean} [immediate] true 时跳过防抖立即写入（见 conversation-store.js 的 saveNow）
   */
  function persistNow(immediate) {
    if (!window.DSConversationStore) {
      return;
    }
    var snapshot = buildPersistSnapshot();
    if (immediate) {
      window.DSConversationStore.saveNow(snapshot);
    } else {
      window.DSConversationStore.scheduleSave(snapshot);
    }
  }

  /**
   * 返回「置顶优先，同组内按更新时间倒序」排序后的对话数组副本。
   */
  function getSortedConversations() {
    var list = conversations.slice();
    list.sort(function (a, b) {
      if (a.pinned !== b.pinned) {
        return a.pinned ? -1 : 1;
      }
      return b.updatedAt - a.updatedAt;
    });
    return list;
  }

  /**
   * 按当前搜索关键词过滤对话（标题或预览文本包含关键词，忽略大小写）。
   */
  function getFilteredConversations() {
    var list = getSortedConversations();
    var kw = searchKeyword.trim().toLowerCase();
    if (!kw) {
      return list;
    }
    return list.filter(function (conv) {
      return (
        (conv.title || "").toLowerCase().indexOf(kw) !== -1 ||
        (conv.preview || "").toLowerCase().indexOf(kw) !== -1
      );
    });
  }

  /**
   * 根据 id 查找对话对象（原始数组中的引用，便于直接修改）。
   */
  function findConversation(id) {
    for (var i = 0; i < conversations.length; i++) {
      if (conversations[i].id === id) {
        return conversations[i];
      }
    }
    return null;
  }

  /**
   * 通知所有订阅者「当前选中对话发生变化」，用于聊天区模块在切换/新建/删除对话时
   * 重新渲染对应的消息列表。传递 null 表示“当前没有任何选中对话”（例如清空全部后）。
   * @param {string|null} id
   */
  function notifyConversationChange(id) {
    var conv = id ? findConversation(id) : null;
    conversationChangeListeners.forEach(function (fn) {
      try {
        fn(conv);
      } catch (err) {
        console.warn("[DSSidebar] 对话切换回调执行出错：", err);
      }
    });
  }

  /**
   * 生成一个简单的唯一 id（时间戳 + 随机数拼接），避免引入额外 UUID 依赖。
   */
  function generateId() {
    return "conv-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  }

  // ================================================================
  // 渲染层
  // ================================================================

  /**
   * 渲染整个对话列表（全量重绘）。
   * Step 2 数据量小（假数据 + 用户手动新建），全量重绘性能完全足够；
   * 后续「千条消息历史不卡顿」的性能优化主要针对消息列表，而非侧边栏对话列表，
   * 对话列表本身数量级通常不会达到需要虚拟滚动的程度。
   */
  function renderList() {
    if (!el.list) {
      return;
    }

    var filtered = getFilteredConversations();

    // 先清空列表容器中除两个空状态占位节点以外的所有子节点
    var itemNodes = el.list.querySelectorAll(".conversation-item, .conversation-group-title");
    itemNodes.forEach(function (node) {
      node.parentNode.removeChild(node);
    });

    // 空状态判断：
    // - 完全没有对话数据 -> 显示「暂无历史对话」
    // - 有数据但搜索过滤后为空 -> 显示「没有找到匹配的对话」
    var hasAnyConversation = conversations.length > 0;
    var hasFilteredResult = filtered.length > 0;

    if (el.emptyAll) {
      el.emptyAll.style.display = !hasAnyConversation ? "" : "none";
    }
    if (el.emptySearch) {
      el.emptySearch.style.display = hasAnyConversation && !hasFilteredResult ? "" : "none";
    }

    if (!hasFilteredResult) {
      return;
    }

    // 分组：置顶 / 普通。仅在存在置顶项且当前未处于搜索状态时展示分组标题，
    // 搜索结果中混合展示即可，避免搜索场景下分组造成视觉割裂。
    var isSearching = searchKeyword.trim().length > 0;
    var pinnedList = filtered.filter(function (c) {
      return c.pinned;
    });
    var normalList = filtered.filter(function (c) {
      return !c.pinned;
    });

    var fragment = document.createDocumentFragment();

    if (!isSearching && pinnedList.length > 0) {
      fragment.appendChild(buildGroupTitle("置顶"));
      pinnedList.forEach(function (conv) {
        fragment.appendChild(buildConversationItem(conv));
      });
      if (normalList.length > 0) {
        fragment.appendChild(buildGroupTitle("全部对话"));
      }
      normalList.forEach(function (conv) {
        fragment.appendChild(buildConversationItem(conv));
      });
    } else {
      filtered.forEach(function (conv) {
        fragment.appendChild(buildConversationItem(conv));
      });
    }

    el.list.appendChild(fragment);

    // 为新插入的节点注入图标（重命名/置顶/删除按钮内的 SVG）
    if (window.DSIcons) {
      window.DSIcons.render(el.list);
    }
  }

  /**
   * 构建分组标题节点（如“置顶”“全部对话”）。
   */
  function buildGroupTitle(text) {
    var div = document.createElement("div");
    div.className = "conversation-group-title";
    div.textContent = text;
    return div;
  }

  /**
   * 构建单条对话列表项的 DOM 节点。
   * 内部通过事件委托思路？此处为简化与清晰度，直接在每个节点上绑定事件，
   * 数据量级（对话列表通常几十到几百条）完全可以接受直接绑定的开销。
   */
  function buildConversationItem(conv) {
    var item = document.createElement("div");
    item.className = "conversation-item" + (conv.id === activeId ? " is-active" : "");
    item.dataset.id = conv.id;
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");
    item.setAttribute("aria-label", "对话：" + conv.title);

    // ---- 主体内容：标题行 + 预览/时间行 ----
    var body = document.createElement("div");
    body.className = "conversation-item__body";

    var titleRow = document.createElement("div");
    titleRow.className = "conversation-item__title-row";

    if (conv.pinned) {
      var pinIcon = document.createElement("span");
      pinIcon.className = "icon conversation-item__pin-icon";
      pinIcon.setAttribute("data-icon", "pin");
      titleRow.appendChild(pinIcon);
    }

    var titleEl = document.createElement("span");
    titleEl.className = "conversation-item__title";
    titleEl.textContent = conv.title || "新对话";
    titleRow.appendChild(titleEl);

    // 重命名输入框：默认隐藏，双击标题或点击“重命名”操作按钮时显示
    var renameInput = document.createElement("input");
    renameInput.type = "text";
    renameInput.className = "conversation-item__rename-input";
    renameInput.value = conv.title || "";
    renameInput.setAttribute("aria-label", "重命名对话");
    titleRow.appendChild(renameInput);

    var metaRow = document.createElement("div");
    metaRow.className = "conversation-item__meta-row";

    var previewEl = document.createElement("span");
    previewEl.className = "conversation-item__preview";
    previewEl.textContent = conv.preview || "";

    var timeEl = document.createElement("span");
    timeEl.className = "conversation-item__time";
    timeEl.textContent = window.DSFormat ? window.DSFormat.formatRelativeTime(conv.updatedAt) : "";

    metaRow.appendChild(previewEl);
    metaRow.appendChild(timeEl);

    body.appendChild(titleRow);
    body.appendChild(metaRow);

    // ---- 操作按钮组：重命名 / 置顶 / 删除 ----
    var actions = document.createElement("div");
    actions.className = "conversation-item__actions";

    var btnRename = buildActionButton("edit", "重命名");
    var btnPin = buildActionButton(conv.pinned ? "unpin" : "pin", conv.pinned ? "取消置顶" : "置顶");
    var btnDelete = buildActionButton("trash", "删除", true);

    actions.appendChild(btnRename);
    actions.appendChild(btnPin);
    actions.appendChild(btnDelete);

    item.appendChild(body);
    item.appendChild(actions);

    // ---- 事件绑定 ----

    // 点击列表项主体：切换选中/高亮状态（点击操作按钮区域时不触发，由 stopPropagation 处理）
    item.addEventListener("click", function () {
      handleSelectConversation(conv.id);
    });
    // 键盘可访问性：Enter / Space 触发选中
    item.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleSelectConversation(conv.id);
      }
    });

    // 双击标题直接进入重命名态，贴近常见网页应用的习惯操作
    titleEl.addEventListener("dblclick", function (e) {
      e.stopPropagation();
      enterRenameMode(item, renameInput);
    });

    btnRename.addEventListener("click", function (e) {
      e.stopPropagation();
      enterRenameMode(item, renameInput);
    });

    renameInput.addEventListener("click", function (e) {
      // 防止点击输入框时冒泡触发整条列表项的“切换选中”逻辑
      e.stopPropagation();
    });
    renameInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        commitRename(conv.id, renameInput.value, item, renameInput);
      } else if (e.key === "Escape") {
        e.preventDefault();
        exitRenameMode(item, renameInput, conv.title);
      }
    });
    renameInput.addEventListener("blur", function () {
      // 失焦时自动提交重命名（若内容为空则还原原标题），避免用户点击别处后态没有收口
      commitRename(conv.id, renameInput.value, item, renameInput);
    });

    btnPin.addEventListener("click", function (e) {
      e.stopPropagation();
      handleTogglePin(conv.id);
    });

    btnDelete.addEventListener("click", function (e) {
      e.stopPropagation();
      handleDeleteConversation(conv.id);
    });

    return item;
  }

  /**
   * 构建操作按钮组内的单个图标按钮。
   * @param {string} iconName 图标名（对应 icons.js 字典）
   * @param {string} label 无障碍文本 / title 提示
   * @param {boolean} [danger] 是否为危险操作（删除），hover 时变红
   */
  function buildActionButton(iconName, label, danger) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "conversation-item__action-btn" + (danger ? " conversation-item__action-btn--danger" : "");
    btn.title = label;
    btn.setAttribute("aria-label", label);
    var icon = document.createElement("span");
    icon.className = "icon";
    icon.setAttribute("data-icon", iconName);
    btn.appendChild(icon);
    return btn;
  }

  // ================================================================
  // 交互处理函数
  // ================================================================

  /**
   * 选中/切换当前对话，更新高亮状态与顶部标题，并通知聊天区模块重新渲染对应消息列表。
   */
  function handleSelectConversation(id) {
    if (activeId === id) {
      // 移动端下，点击当前已选中的对话也应关闭抽屉，提升可用性
      if (isMobileViewport()) {
        closeMobileDrawer();
      }
      return;
    }
    activeId = id;
    renderList();
    var conv = findConversation(id);
    if (el.mainHeaderTitle && conv) {
      el.mainHeaderTitle.textContent = conv.title || "新对话";
    }
    // 移动端选中对话后自动收起抽屉，桌面端保持展开
    if (isMobileViewport()) {
      closeMobileDrawer();
    }
    notifyConversationChange(id);
  }

  /**
   * 新建空白对话：插入一条新对话到数组最前，并立即选中、重绘列表。
   */
  function handleNewConversation() {
    var newConv = {
      id: generateId(),
      title: "新对话",
      preview: "",
      updatedAt: Date.now(),
      pinned: false,
      messages: []
    };
    conversations.unshift(newConv);
    activeId = newConv.id;
    renderList();
    if (el.mainHeaderTitle) {
      el.mainHeaderTitle.textContent = newConv.title;
    }
    if (window.DSToast) {
      window.DSToast.success("已新建对话");
    }
    if (isMobileViewport()) {
      closeMobileDrawer();
    }
    // 新建后清空搜索框，避免当前搜索关键词把刚新建的空对话过滤掉导致“看起来没反应”
    if (el.searchInput && el.searchInput.value) {
      el.searchInput.value = "";
      searchKeyword = "";
    }
    notifyConversationChange(newConv.id);
    persistNow(true);
  }

  /**
   * 新建一个带预置标题与预置消息的对话（供"导入文件"功能调用）：
   * 与 handleNewConversation 的流程基本一致，只是标题与初始消息可以自定义，
   * 不是固定的"新对话"空白态。
   * @param {string} title
   * @param {Array} messages 预置消息数组（标准 {id, role, content} 结构）
   * @returns {Object} 新建的对话对象
   */
  function createConversationWithMessages(title, messages) {
    var newConv = {
      id: generateId(),
      title: title || "新对话",
      preview: messages && messages.length ? messages[messages.length - 1].content : "",
      updatedAt: Date.now(),
      pinned: false,
      messages: messages || []
    };
    conversations.unshift(newConv);
    activeId = newConv.id;
    renderList();
    if (el.mainHeaderTitle) {
      el.mainHeaderTitle.textContent = newConv.title;
    }
    if (isMobileViewport()) {
      closeMobileDrawer();
    }
    if (el.searchInput && el.searchInput.value) {
      el.searchInput.value = "";
      searchKeyword = "";
    }
    notifyConversationChange(newConv.id);
    persistNow(true);
    return newConv;
  }

  /**
   * 删除单条对话：二次确认后从数组移除，并立即从 IndexedDB 里一并删除持久化数据。
   */
  function handleDeleteConversation(id) {
    var conv = findConversation(id);
    if (!conv) {
      return;
    }
    window.DSConfirm
      .show({
        title: "删除对话",
        message: '删除后将无法恢复，确定要删除「' + conv.title + '」吗？',
        confirmText: "删除",
        danger: true
      })
      .then(function (ok) {
        if (!ok) {
          return;
        }
        var idx = conversations.findIndex(function (c) {
          return c.id === id;
        });
        if (idx === -1) {
          return;
        }
        conversations.splice(idx, 1);

        // 若删除的是当前选中对话，自动切换到列表中第一条（若还有），否则清空选中态
        if (activeId === id) {
          var remaining = getSortedConversations();
          activeId = remaining.length > 0 ? remaining[0].id : null;
          if (el.mainHeaderTitle) {
            el.mainHeaderTitle.textContent = activeId ? findConversation(activeId).title : "新对话";
          }
        }
        renderList();
        if (window.DSToast) {
          window.DSToast.success("已删除对话");
        }
        notifyConversationChange(activeId);
        persistNow(true);
      });
  }

  /**
   * 清空全部对话：二次确认后清空数组。
   */
  function handleClearAll() {
    if (conversations.length === 0) {
      if (window.DSToast) {
        window.DSToast.warning("当前没有可清空的对话");
      }
      return;
    }
    window.DSConfirm
      .show({
        title: "清空全部对话",
        message: "此操作将删除全部 " + conversations.length + " 条对话历史，且无法恢复，确定要继续吗？",
        confirmText: "全部清空",
        danger: true
      })
      .then(function (ok) {
        if (!ok) {
          return;
        }
        conversations = [];
        activeId = null;
        if (el.mainHeaderTitle) {
          el.mainHeaderTitle.textContent = "新对话";
        }
        renderList();
        if (window.DSToast) {
          window.DSToast.success("已清空全部对话");
        }
        notifyConversationChange(null);
        persistNow(true);
      });
  }

  /**
   * 切换置顶状态。
   */
  function handleTogglePin(id) {
    var conv = findConversation(id);
    if (!conv) {
      return;
    }
    conv.pinned = !conv.pinned;
    renderList();
    persistNow(false);
    if (window.DSToast) {
      window.DSToast.success(conv.pinned ? "已置顶" : "已取消置顶");
    }
  }

  /**
   * 进入重命名态：显示输入框并聚焦、全选文字，隐藏标题文本。
   */
  function enterRenameMode(itemEl, inputEl) {
    itemEl.classList.add("is-renaming");
    inputEl.focus();
    inputEl.select();
  }

  /**
   * 退出重命名态但不保存修改（用于 ESC 取消场景），还原输入框内容为原标题。
   */
  function exitRenameMode(itemEl, inputEl, originalTitle) {
    inputEl.value = originalTitle || "";
    itemEl.classList.remove("is-renaming");
  }

  /**
   * 提交重命名：
   * - 若输入为空或仅空白，还原为原标题（边界处理：禁止空标题）
   * - 否则更新对话标题并重绘列表
   */
  function commitRename(id, newTitle, itemEl, inputEl) {
    var conv = findConversation(id);
    if (!conv) {
      return;
    }
    var trimmed = (newTitle || "").trim();
    if (!trimmed) {
      exitRenameMode(itemEl, inputEl, conv.title);
      return;
    }
    // 限制标题长度，避免极端超长文本破坏列表布局（边界处理）
    var MAX_TITLE_LENGTH = 40;
    if (trimmed.length > MAX_TITLE_LENGTH) {
      trimmed = trimmed.slice(0, MAX_TITLE_LENGTH);
    }
    conv.title = trimmed;
    itemEl.classList.remove("is-renaming");
    renderList();
    persistNow(true);
    if (activeId === id && el.mainHeaderTitle) {
      el.mainHeaderTitle.textContent = trimmed;
    }
    if (window.DSToast) {
      window.DSToast.success("已重命名");
    }
  }

  /**
   * 搜索框输入处理：实时按关键词过滤列表。
   */
  function handleSearchInput(e) {
    searchKeyword = e.target.value || "";
    renderList();
  }

  // ================================================================
  // 侧边栏展开/收起（桌面端） & 抽屉开关（移动端）
  // ================================================================

  /**
   * 桌面端：切换侧边栏「展开 / 仅图标收起」两态。
   */
  function toggleDesktopCollapse() {
    isCollapsed = !isCollapsed;
    if (el.sidebar) {
      el.sidebar.classList.toggle("is-collapsed", isCollapsed);
    }
    if (el.btnCollapse) {
      el.btnCollapse.setAttribute("aria-label", isCollapsed ? "展开侧边栏" : "收起侧边栏");
      // 收起态下把图标从“收起”换成“展开”方向，给出明确的下一步操作提示
      var iconSpan = el.btnCollapse.querySelector(".icon");
      if (iconSpan) {
        iconSpan.setAttribute("data-icon", isCollapsed ? "expand" : "collapse");
        iconSpan.removeAttribute("data-icon-rendered");
        if (window.DSIcons) {
          window.DSIcons.render(el.btnCollapse);
        }
      }
    }
  }

  /**
   * 移动端：打开抽屉式侧边栏 + 显示遮罩层。
   */
  function openMobileDrawer() {
    if (el.sidebar) {
      el.sidebar.classList.add("is-open");
    }
    if (el.overlay) {
      el.overlay.hidden = false;
    }
    // 锁定 body 滚动，避免抽屉打开时背后页面还能被滑动（移动端常见体验问题）
    document.body.style.overflow = "hidden";
  }

  /**
   * 移动端：关闭抽屉式侧边栏 + 隐藏遮罩层。
   */
  function closeMobileDrawer() {
    if (el.sidebar) {
      el.sidebar.classList.remove("is-open");
    }
    if (el.overlay) {
      el.overlay.hidden = true;
    }
    document.body.style.overflow = "";
  }

  /**
   * 收起/展开按钮的统一入口：根据当前视口宽度决定具体行为。
   * - 桌面端：切换图标收起态
   * - 移动端：该按钮本身在 responsive.css 中已隐藏，不会触发（由汉堡按钮代替）
   */
  function handleCollapseBtnClick() {
    if (isMobileViewport()) {
      closeMobileDrawer();
    } else {
      toggleDesktopCollapse();
    }
  }

  // ================================================================
  // 快捷键：Ctrl+K 新建对话、Ctrl+F 聚焦搜索框
  // ================================================================
  function handleGlobalKeydown(e) {
    var isCtrlOrCmd = e.ctrlKey || e.metaKey;
    if (!isCtrlOrCmd) {
      return;
    }
    // Ctrl/Cmd + K：新建对话
    if (e.key.toLowerCase() === "k") {
      e.preventDefault();
      handleNewConversation();
      return;
    }
    // Ctrl/Cmd + F：聚焦搜索框（并在移动端自动打开抽屉，否则输入框不可见）
    if (e.key.toLowerCase() === "f") {
      e.preventDefault();
      if (isMobileViewport()) {
        openMobileDrawer();
      }
      // 若侧边栏处于收起态（桌面端），先展开，否则搜索框不可见也无法聚焦
      if (isCollapsed && !isMobileViewport()) {
        toggleDesktopCollapse();
      }
      if (el.searchInput) {
        el.searchInput.focus();
      }
    }
  }

  // ================================================================
  // 初始化：绑定事件 + 首次渲染
  // ================================================================
  function init() {
    cacheDom();
    loadMockConversations();
    renderList();

    if (el.mainHeaderTitle && activeId) {
      var conv = findConversation(activeId);
      if (conv) {
        el.mainHeaderTitle.textContent = conv.title;
      }
    }

    // 把"如何拿到最新完整数据快照"的方法交给持久化模块，供它在写入过程中又发生
    // 新变化时，补一次写入最新数据（见 conversation-store.js 的 saveNow 里 pendingResave 逻辑）
    if (window.DSConversationStore) {
      window.DSConversationStore.getLatestSnapshot = buildPersistSnapshot;
    }
    // 启动后异步检查 IndexedDB 里是否有之前保存过的真实数据，有就整体替换掉演示数据
    loadPersistedConversationsAsync();

    if (el.btnNewChat) {
      el.btnNewChat.addEventListener("click", handleNewConversation);
    }
    if (el.btnClearAll) {
      el.btnClearAll.addEventListener("click", handleClearAll);
    }
    if (el.btnCollapse) {
      el.btnCollapse.addEventListener("click", handleCollapseBtnClick);
    }
    if (el.btnOpenSidebarMobile) {
      el.btnOpenSidebarMobile.addEventListener("click", openMobileDrawer);
    }
    if (el.overlay) {
      el.overlay.addEventListener("click", closeMobileDrawer);
    }
    if (el.searchInput) {
      el.searchInput.addEventListener("input", handleSearchInput);
    }

    document.addEventListener("keydown", handleGlobalKeydown);

    // 视口从移动端切回桌面端时，确保抽屉态/遮罩被正确复位，避免窗口缩放造成的状态错乱（边界处理）
    window.addEventListener("resize", function () {
      if (!isMobileViewport()) {
        closeMobileDrawer();
      }
    });

    console.log("[DSSidebar] 初始化完成，当前对话数：" + conversations.length);
  }

  // 挂载到全局命名空间，供 main.js 统一调度初始化，也方便后续 Step 的其他模块
  // （例如聊天区）在切换对话时调用 DSSidebar 提供的查询方法。
  window.DSSidebar = {
    init: init,
    // 供后续聊天区 Step 查询当前选中的对话 id / 对象（只读用途）
    getActiveId: function () {
      return activeId;
    },
    getActiveConversation: function () {
      return activeId ? findConversation(activeId) : null;
    },
    /**
     * 订阅「当前选中对话变化」事件（切换/新建/删除/清空全部均会触发）。
     * 回调参数为新的当前对话对象，清空全部对话等场景下可能为 null。
     * 供聊天区模块（chat.js）调用，以在对话切换时重新渲染对应的消息列表。
     * @param {(conv: object|null) => void} callback
     */
    onConversationChange: function (callback) {
      if (typeof callback === "function") {
        conversationChangeListeners.push(callback);
      }
    },
    /**
     * 更新指定对话的「最后一条消息预览」与「最后更新时间」，供聊天区模块
     * 在发送/接收消息后调用，使侧边栏列表的预览文本与时间排序保持同步。
     * 仅做数据更新 + 重绘列表，不触发 onConversationChange（避免递归通知）。
     * @param {string} id
     * @param {string} previewText
     */
    updateConversationPreview: function (id, previewText) {
      var conv = findConversation(id);
      if (!conv) {
        return;
      }
      conv.preview = previewText;
      conv.updatedAt = Date.now();
      renderList();
    },
    /**
     * 更新指定对话的标题（供聊天区模块实现“首条消息自动生成标题”）。
     * @param {string} id
     * @param {string} title
     */
    updateConversationTitle: function (id, title) {
      var conv = findConversation(id);
      if (!conv) {
        return;
      }
      conv.title = title;
      renderList();
      if (activeId === id && el.mainHeaderTitle) {
        el.mainHeaderTitle.textContent = title;
      }
    },
    /**
     * 触发一次持久化保存，供 chat.js 在消息状态发生变化后调用
     * （真正的保存逻辑见 js/core/conversation-store.js，这里只是把 sidebar.js
     * 自己的对话元数据和 chat.js 的消息数组拼成完整快照后转交过去）。
     * @param {boolean} [immediate] true 跳过防抖立即写入
     */
    persistNow: function (immediate) {
      persistNow(immediate);
    },
    // 供 js/modules/sidebar/import-file.js 调用：新建一个带预置标题/消息的对话
    createConversationWithMessages: createConversationWithMessages
  };
})();
