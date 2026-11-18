/**
 * ============================================================
 * toast.js —— 全局 Toast 提示模块（核心基础设施）
 * ============================================================
 * 提供 success / error / warning / loading 四种状态的全局提示，
 * 挂载到 window.DSToast，供任意模块调用：
 *   DSToast.success('已删除对话')
 *   DSToast.error('网络连接失败')
 *   DSToast.warning('请先填写 API Key')
 *   var hide = DSToast.loading('正在生成...'); // 返回一个关闭函数，手动调用以提前关闭
 *
 * 容器节点 #toast-container 已在 index.html（Step 1）中预留，
 * 本模块只负责动态创建/移除内部的 .toast-item 节点。
 * ============================================================
 */

(function () {
  "use strict";

  // 普通提示（success/error/warning）自动消失的时间（毫秒）
  var AUTO_DISMISS_MS = 2600;

  /**
   * 获取 toast 容器节点。做一次性缓存，避免重复查询 DOM。
   */
  var containerEl = null;
  function getContainer() {
    if (!containerEl) {
      containerEl = document.getElementById("toast-container");
    }
    return containerEl;
  }

  /**
   * 四种状态对应的图标名称（复用 js/utils/icons.js 中已定义的图标字典）
   */
  var ICON_MAP = {
    success: "thumb-up", // 暂复用已有图标，避免为 Step 2 新增过多图标定义；后续 Step 可替换为专用对勾图标
    error: "close",
    warning: "compress", // 占位复用，无专门警告图标时退化处理，不影响功能
    loading: "refresh"
  };

  /**
   * 创建并显示一条 toast。
   * @param {'success'|'error'|'warning'|'loading'} type
   * @param {string} message
   * @param {number} [duration] 自动关闭时长（毫秒），loading 类型默认不自动关闭
   * @returns {Function} 关闭函数，调用后立即移除该条提示
   */
  function show(type, message, duration) {
    var container = getContainer();
    if (!container) {
      // 边界处理：容器节点缺失时退化为 console 输出，避免功能彻底不可用
      console.warn("[DSToast] 未找到 #toast-container 节点，提示内容：" + message);
      return function noop() {};
    }

    var item = document.createElement("div");
    item.className = "toast-item toast-item--" + type;

    var iconSpan = document.createElement("span");
    iconSpan.className = "icon toast-item__icon";
    iconSpan.setAttribute("data-icon", ICON_MAP[type] || "close");

    var textSpan = document.createElement("span");
    textSpan.className = "toast-item__text";
    // 使用 textContent 而非 innerHTML，天然防止 XSS 注入
    textSpan.textContent = message;

    item.appendChild(iconSpan);
    item.appendChild(textSpan);
    container.appendChild(item);

    // 图标注入：若 icons.js 已加载，则渲染新插入节点内的图标
    if (window.DSIcons && typeof window.DSIcons.render === "function") {
      window.DSIcons.render(item);
    }

    // 下一帧添加 is-visible 触发 CSS 过渡动画（直接同帧添加可能不会触发 transition）
    requestAnimationFrame(function () {
      item.classList.add("is-visible");
    });

    var dismissed = false;
    function dismiss() {
      if (dismissed) {
        return;
      }
      dismissed = true;
      item.classList.remove("is-visible");
      // 等待过渡动画结束后再从 DOM 移除，避免闪烁
      setTimeout(function () {
        if (item.parentNode) {
          item.parentNode.removeChild(item);
        }
      }, 300);
    }

    // loading 类型默认不自动关闭，由调用方持有返回的 dismiss 函数手动关闭
    if (type !== "loading") {
      setTimeout(dismiss, duration || AUTO_DISMISS_MS);
    }

    return dismiss;
  }

  window.DSToast = {
    success: function (msg, duration) {
      return show("success", msg, duration);
    },
    error: function (msg, duration) {
      return show("error", msg, duration);
    },
    warning: function (msg, duration) {
      return show("warning", msg, duration);
    },
    loading: function (msg) {
      return show("loading", msg);
    }
  };
})();
