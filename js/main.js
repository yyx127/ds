/**
 * ============================================================
 * main.js —— 应用入口脚本
 * ============================================================
 * 当前阶段（Step 1）职责范围：
 *   1. 等待 DOM 加载完成
 *   2. 做最基础的「占位挂载」：缓存关键 DOM 节点引用、
 *      打印初始化日志，验证脚本加载顺序与骨架是否正常
 *   3. 不实现任何聊天、侧边栏交互逻辑 —— 这些留给后续 Step
 *      （侧边栏 UI、消息渲染、输入栏交互、设置面板、压缩引擎、API 适配层等）
 *
 * 后续 Step 接入方式说明（给后续开发/后续 Step 看的注释）：
 *   届时会在 index.html 中按「配置 -> 工具 -> 核心 -> API -> 功能模块 -> 入口」
 *   的顺序新增 <script> 引入对应模块文件，各模块会把自己的初始化函数
 *   挂载到各自的命名空间对象上（例如 window.DSSidebar.init()、
 *   window.DSChat.init() 等），然后统一在本文件的 initApp() 函数中依次调用。
 * ============================================================
 */

(function () {
  "use strict";

  /**
   * DOM 节点引用缓存对象。
   * Step 1 先把骨架中关键容器节点都取出来缓存，避免后续模块重复查询 DOM，
   * 同时也作为一种「骨架完整性校验」：任何一个节点取不到，说明 HTML 结构被破坏。
   * 挂载到 window.DSDom，供后续 Step 的各功能模块直接复用，不必重复 getElementById。
   */
  var domRefs = {
    app: null,
    sidebarOverlay: null,
    sidebar: null,
    btnCollapseSidebar: null,
    btnNewChat: null,
    inputSearchConv: null,
    conversationList: null,
    conversationListEmpty: null,
    btnOpenSettings: null,
    btnClearAll: null,
    mainPanel: null,
    btnOpenSidebarMobile: null,
    mainHeaderTitle: null,
    btnCompressContext: null,
    chatArea: null,
    messageList: null,
    emptyState: null,
    btnScrollBottom: null,
    inputArea: null,
    btnAttach: null,
    btnToggleThinking: null,
    textareaMessage: null,
    btnSend: null,
    statusTokenEstimate: null,
    statusModelName: null,
    settingsModal: null,
    settingsModalMask: null,
    toastContainer: null
  };

  /**
   * 采集 DOM 节点引用。
   * 使用 getElementById 按 index.html 中约定好的 id 逐一取出，
   * 统一收口在一个函数里，便于后续排查「某个节点取不到」的问题。
   */
  function collectDomRefs() {
    domRefs.app = document.getElementById("app");
    domRefs.sidebarOverlay = document.getElementById("sidebar-overlay");
    domRefs.sidebar = document.getElementById("sidebar");
    domRefs.btnCollapseSidebar = document.getElementById("btn-collapse-sidebar");
    domRefs.btnNewChat = document.getElementById("btn-new-chat");
    domRefs.inputSearchConv = document.getElementById("input-search-conv");
    domRefs.conversationList = document.getElementById("conversation-list");
    domRefs.conversationListEmpty = document.getElementById("conversation-list-empty");
    domRefs.btnOpenSettings = document.getElementById("btn-open-settings");
    domRefs.btnClearAll = document.getElementById("btn-clear-all");
    domRefs.mainPanel = document.getElementById("main-panel");
    domRefs.btnOpenSidebarMobile = document.getElementById("btn-open-sidebar-mobile");
    domRefs.mainHeaderTitle = document.getElementById("main-header-title");
    domRefs.btnCompressContext = document.getElementById("btn-compress-context");
    domRefs.chatArea = document.getElementById("chat-area");
    domRefs.messageList = document.getElementById("message-list");
    domRefs.emptyState = document.getElementById("empty-state");
    domRefs.btnScrollBottom = document.getElementById("btn-scroll-bottom");
    domRefs.inputArea = document.getElementById("input-area");
    domRefs.btnAttach = document.getElementById("btn-attach");
    domRefs.btnToggleThinking = document.getElementById("btn-toggle-thinking");
    domRefs.textareaMessage = document.getElementById("textarea-message");
    domRefs.btnSend = document.getElementById("btn-send");
    domRefs.statusTokenEstimate = document.getElementById("status-token-estimate");
    domRefs.statusModelName = document.getElementById("status-model-name");
    domRefs.settingsModal = document.getElementById("settings-modal");
    domRefs.settingsModalMask = document.getElementById("settings-modal-mask");
    domRefs.toastContainer = document.getElementById("toast-container");
  }

  /**
   * 骨架完整性校验：
   * 遍历 domRefs，若有任意关键节点为 null，在控制台输出警告，
   * 提醒开发者 HTML 结构可能被误改动。这是边界处理的一部分，
   * 避免后续 Step 的模块在节点不存在时抛出难以定位的空指针异常。
   */
  function verifyDomRefs() {
    var missing = [];
    for (var key in domRefs) {
      if (Object.prototype.hasOwnProperty.call(domRefs, key)) {
        if (!domRefs[key]) {
          missing.push(key);
        }
      }
    }
    if (missing.length > 0) {
      // 使用 console.warn 而不是抛出异常：Step 1 阶段允许骨架不完整时仍可预览页面，
      // 但必须明确告警，方便排查。
      console.warn(
        "[DSMain] 以下关键 DOM 节点未找到，请检查 index.html 结构是否完整：",
        missing
      );
    } else {
      console.log("[DSMain] 骨架 DOM 节点校验通过，共 " + Object.keys(domRefs).length + " 个关键节点。");
    }
  }

  /**
   * 应用初始化入口函数。
   * Step 1 版本：仅完成 DOM 采集与校验、读取全局配置做一次打印确认。
   * 后续 Step 会在此函数内，按依赖顺序依次调用各功能模块的 init 方法，
   * 例如（示意，当前尚未实现，先留空不调用）：
   *   window.DSTheme && window.DSTheme.init();
   *   window.DSSidebar && window.DSSidebar.init();
   *   window.DSChat && window.DSChat.init();
   *   window.DSInput && window.DSInput.init();
   *   window.DSSettings && window.DSSettings.init();
   *   window.DSCompress && window.DSCompress.init();
   */
  function initApp() {
    collectDomRefs();
    verifyDomRefs();

    // 校验全局配置是否已正确加载（config.js 必须先于 main.js 加载）
    if (window.DSConfig) {
      console.log(
        "[DSMain] 全局配置已加载：" +
          window.DSConfig.appName +
          " v" +
          window.DSConfig.appVersion
      );
    } else {
      console.warn("[DSMain] 未检测到 window.DSConfig，请确认 config.js 已在 main.js 之前加载。");
    }

    // 图标注入：对初始静态 HTML 中所有 data-icon 占位节点渲染真实 SVG 图标
    if (window.DSIcons) {
      window.DSIcons.render(document);
    }

    // 主题引擎初始化：尽早应用深浅色/配色包/自定义配色，放在其他 UI 模块之前
    if (window.DSTheme && typeof window.DSTheme.init === "function") {
      window.DSTheme.init();
    } else {
      console.warn("[DSMain] 未检测到 window.DSTheme，主题功能未初始化。");
    }

    // 侧边栏模块初始化（假数据渲染 + 交互逻辑）
    if (window.DSSidebar && typeof window.DSSidebar.init === "function") {
      window.DSSidebar.init();
    } else {
      console.warn("[DSMain] 未检测到 window.DSSidebar，侧边栏功能未初始化。");
    }

    // 导入文件模块初始化（读取外部文本并自动压缩为新对话开场摘要）
    if (window.DSImportFile && typeof window.DSImportFile.init === "function") {
      window.DSImportFile.init();
    } else {
      console.warn("[DSMain] 未检测到 window.DSImportFile，导入文件功能未初始化。");
    }

    // 设置面板模块初始化（Step 5：API 设置分区，供用户填写 Base URL / Key / 模型名等）
    if (window.DSSettings && typeof window.DSSettings.init === "function") {
      window.DSSettings.init();
    } else {
      console.warn("[DSMain] 未检测到 window.DSSettings，设置面板未初始化。");
    }

    // 聊天区模块初始化（Step 5：已对接通用 API 适配层，依赖 DSSidebar 已初始化完成）
    if (window.DSChat && typeof window.DSChat.init === "function") {
      window.DSChat.init();
    } else {
      console.warn("[DSMain] 未检测到 window.DSChat，聊天区功能未初始化。");
    }

    // 附件模块初始化（真实的本地文件选择 + 预览，发送能力受当前接口配置把关）
    if (window.DSAttachments && typeof window.DSAttachments.init === "function") {
      window.DSAttachments.init();
    } else {
      console.warn("[DSMain] 未检测到 window.DSAttachments，附件功能未初始化。");
    }

    // 输入栏模块初始化（发送/停止已对接 DSChat 的本地消息状态管理）
    if (window.DSInput && typeof window.DSInput.init === "function") {
      window.DSInput.init();
    } else {
      console.warn("[DSMain] 未检测到 window.DSInput，输入栏功能未初始化。");
    }

    // 页面关闭/刷新前，强制立即保存一次，捞回任何还在 400ms 防抖等待中、尚未真正落盘的变化
    // （IndexedDB 的写入是异步的，beforeunload 里无法保证它一定在页面卸载前跑完，
    // 但发起请求本身是同步调用，现代浏览器通常会给已发起的 IndexedDB 事务一个收尾的机会，
    // 这是尽力而为的兜底，不是 100% 保证，正常的"停止生成/切换对话"等场景已经各自立即保存过了）
    window.addEventListener("beforeunload", function () {
      if (window.DSSidebar && typeof window.DSSidebar.persistNow === "function") {
        window.DSSidebar.persistNow(true);
      }
    });

    console.log("[DSMain] 初始化完成：对话与消息已接入 IndexedDB 真实持久化，刷新页面不再丢失历史记录。");
  }

  // 将 DOM 节点引用挂载到全局命名空间，供后续 Step 的功能模块直接复用
  window.DSDom = domRefs;

  /**
   * 入口挂载：
   * 使用 DOMContentLoaded 事件确保在 DOM 树构建完成后才执行初始化逻辑，
   * 避免脚本在 <head> 中同步执行时取不到尚未渲染的 body 内节点
   * （本项目脚本虽然放在 body 末尾，这里仍加上判断作为双重保险，
   * 兼容脚本位置未来被调整的情况）。
   */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
  } else {
    // 若脚本执行时 DOM 已经解析完毕（例如被异步/延迟加载），直接初始化
    initApp();
  }
})();
