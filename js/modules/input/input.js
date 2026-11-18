/**
 * ============================================================
 * input.js —— 底部输入栏交互模块（Step 4：对接本地消息状态管理）
 * ============================================================
 * 职责范围：
 *   1. 自动增高文本框：随输入内容自动撑高，超过最大高度后内部滚动
 *   2. Enter 发送 / Shift+Enter 换行 / 空消息禁止发送 / 发送后清空输入框
 *   3. Esc 停止当前生成；Ctrl+K 新建对话（侧边栏模块处理）；
 *      Ctrl+F 聚焦搜索框（侧边栏模块处理）
 *   4. 深度思考开关：纯视觉切换 aria-pressed 状态
 *   5. 底部状态栏 Token 粗估实时刷新
 *
 * 【职责边界】本模块不再直接操作消息 DOM / 消息状态——
 * 真正的“发送一条消息会发生什么”（追加用户气泡、插入加载行、模拟流式回复、
 * 自动滚动、同步侧边栏预览）全部交给 js/modules/chat/chat.js 的
 * window.DSChat.sendUserMessage() / stopGenerating() 处理，
 * 这样输入栏只负责“输入体验”本身，消息业务逻辑集中在一处，便于后续
 * Step 把 sendUserMessage 内部的模拟逻辑替换为真实 API 调用而不影响本文件。
 * ============================================================
 */

(function () {
  "use strict";

  var el = {};

  // 文本框最大高度（像素），对应 CSS 中 .input-box__textarea 的 max-height，这里做 JS 侧的二次确认，
  // 避免未来 CSS 调整时 JS 行为与样式不一致（JS 计算高度时会与此值做比较）。
  var TEXTAREA_MAX_HEIGHT = 200;

  function cacheDom() {
    el.textarea = document.getElementById("textarea-message");
    el.btnSend = document.getElementById("btn-send");
    el.btnToggleThinking = document.getElementById("btn-toggle-thinking");
    el.statusTokenEstimate = document.getElementById("status-token-estimate");
  }

  // ================================================================
  // 自动增高文本框
  // ================================================================

  /**
   * 根据当前内容重新计算文本框高度：
   * - 先重置为 auto，让浏览器重新计算真实内容高度（scrollHeight）
   * - 再取 min(内容高度, 最大高度) 作为最终高度
   * - 超过最大高度时，textarea 自身的 overflow-y: auto（CSS 已设置）会出现内部滚动条
   */
  function autoGrowTextarea() {
    if (!el.textarea) {
      return;
    }
    el.textarea.style.height = "auto";
    var contentHeight = el.textarea.scrollHeight;
    var finalHeight = Math.min(contentHeight, TEXTAREA_MAX_HEIGHT);
    el.textarea.style.height = finalHeight + "px";
  }

  /**
   * 粗略估算当前输入框内容的 Token 数（仅用于底部状态栏实时展示的简化版本，
   * 真实的上下文 Token 估算算法——涵盖系统提示词与历史消息——将在「压缩机制」Step 中实现）。
   * 简化规则：中文字符按约 1.5 字符折算 1 token，英文按约 4 字符折算 1 token。
   */
  function estimateTokenRough(text) {
    if (!text) {
      return 0;
    }
    var cnCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    var otherCount = text.length - cnCount;
    var cfg = (window.DSConfig && window.DSConfig.defaultTokenEstimateConfig) || {
      cnCharsPerToken: 1.5,
      enCharsPerToken: 4
    };
    var tokens = cnCount / cfg.cnCharsPerToken + otherCount / cfg.enCharsPerToken;
    return Math.ceil(tokens);
  }

  function updateTokenStatus() {
    if (!el.statusTokenEstimate || !el.textarea) {
      return;
    }
    var tokens = estimateTokenRough(el.textarea.value);
    el.statusTokenEstimate.textContent = "预估 Token：" + tokens;
  }

  function handleTextareaInput() {
    autoGrowTextarea();
    updateTokenStatus();
    syncSendButtonState();
  }

  /**
   * 发送按钮禁用态同步：
   * - 生成中：按钮用于“停止”，始终可点击
   * - 非生成中：输入文本非空，或存在待发送附件（哪怕没有文字）时才可点击，
   *   避免发送真正意义上的空消息（文字和附件都没有）（边界处理）
   * 导出为 window.DSInput.syncSendButtonState，供 chat.js 在生成状态切换时回调同步，
   * 也供 attachments.js 在增删附件后回调同步。
   */
  function syncSendButtonState() {
    if (!el.btnSend || !el.textarea) {
      return;
    }
    var generating = window.DSChat && window.DSChat.isGenerating();
    if (generating) {
      el.btnSend.disabled = false;
      return;
    }
    var hasContent = el.textarea.value.trim().length > 0;
    var hasAttachments = window.DSAttachments && window.DSAttachments.hasDraftAttachments();
    el.btnSend.disabled = !hasContent && !hasAttachments;
  }

  // ================================================================
  // 发送 / 停止：委托给 chat.js 的状态管理
  // ================================================================

  /**
   * 处理发送按钮点击 / Enter 键：
   * - 若当前正在生成中，点击等同于“停止”（委托 DSChat.stopGenerating）
   * - 否则校验输入非空后，委托 DSChat.sendUserMessage 处理完整的发送流程
   */
  function handleSendOrStop() {
    if (!window.DSChat) {
      console.warn("[DSInput] 未检测到 window.DSChat，发送功能不可用。");
      return;
    }
    if (window.DSChat.isGenerating()) {
      window.DSChat.stopGenerating();
      return;
    }
    var content = el.textarea ? el.textarea.value.trim() : "";
    var hasAttachments = window.DSAttachments && window.DSAttachments.hasDraftAttachments();
    // 边界处理：文本为空但带了附件也允许发送（常见于“只发一张图不配文字”），
    // 只有文本和附件都没有时才算真正的空消息，禁止发送。
    if (!content && !hasAttachments) {
      return;
    }

    // 能力把关：当前适配的接口未声明支持文件发送时，不静默丢弃附件、也不假装发送成功，
    // 而是明确提示用户，让用户自行决定是去设置里切换支持文件的接口，还是先移除附件再发送纯文本。
    if (hasAttachments && !window.DSAttachments.isFileSendingSupported()) {
      if (window.DSToast) {
        window.DSToast.warning("当前模型暂不支持发送文件，请移除附件或先发送文字");
      }
      return;
    }

    var attachments = hasAttachments ? window.DSAttachments.getDraftAttachmentsSnapshot() : [];
    window.DSChat.sendUserMessage(content, attachments);

    if (hasAttachments) {
      window.DSAttachments.clearDraftAttachments();
    }

    // 发送后清空输入框并重置高度、状态栏
    el.textarea.value = "";
    autoGrowTextarea();
    updateTokenStatus();
    syncSendButtonState();
  }

  // ================================================================
  // 键盘快捷键：Enter 发送 / Shift+Enter 换行 / Esc 停止
  // ================================================================
  function handleTextareaKeydown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendOrStop();
      return;
    }
    if (e.key === "Escape") {
      if (window.DSChat && window.DSChat.isGenerating()) {
        e.preventDefault();
        window.DSChat.stopGenerating();
      }
    }
    // Shift+Enter 不做任何 preventDefault，交由浏览器默认行为插入换行
  }

  /**
   * 全局 Esc 监听：即便焦点不在输入框内（例如用户点开了思考面板后失焦），
   * 生成中时按 Esc 也应能停止，提升可用性（边界处理，覆盖输入框未聚焦的场景）。
   */
  function handleGlobalKeydownForStop(e) {
    if (
      e.key === "Escape" &&
      window.DSChat &&
      window.DSChat.isGenerating() &&
      document.activeElement !== el.textarea
    ) {
      window.DSChat.stopGenerating();
    }
  }

  // ================================================================
  // 深度思考开关：纯视觉切换
  // ================================================================
  function handleToggleThinking() {
    if (!el.btnToggleThinking) {
      return;
    }
    var pressed = el.btnToggleThinking.getAttribute("aria-pressed") === "true";
    el.btnToggleThinking.setAttribute("aria-pressed", pressed ? "false" : "true");
  }

  // ================================================================
  // 初始化
  // ================================================================
  function init() {
    cacheDom();
    if (!el.textarea || !el.btnSend) {
      console.warn("[DSInput] 未找到输入框或发送按钮节点，输入栏功能未初始化。");
      return;
    }

    el.textarea.addEventListener("input", handleTextareaInput);
    el.textarea.addEventListener("keydown", handleTextareaKeydown);
    el.btnSend.addEventListener("click", handleSendOrStop);
    document.addEventListener("keydown", handleGlobalKeydownForStop);

    if (el.btnToggleThinking) {
      el.btnToggleThinking.addEventListener("click", handleToggleThinking);
    }

    // 初始状态计算一次，保证发送按钮禁用态与状态栏文本在页面加载时就是正确的
    autoGrowTextarea();
    updateTokenStatus();
    syncSendButtonState();

    console.log("[DSInput] 输入栏模块初始化完成（Step 4：发送/停止已对接本地消息状态管理）。");
  }

  window.DSInput = {
    init: init,
    syncSendButtonState: syncSendButtonState
  };
})();
