/**
 * ============================================================
 * format.js —— 通用格式化工具函数
 * ============================================================
 * 当前阶段提供：相对时间格式化（侧边栏对话列表的时间展示）。
 * 后续 Step 如需新增「文件大小格式化」「Token 数千分位格式化」等，
 * 统一追加到本文件，避免格式化逻辑分散在各业务模块中。
 * ============================================================
 */

(function () {
  "use strict";

  /**
   * 将时间戳格式化为对齐 DeepSeek 官方风格的相对/简短时间文本。
   * 规则：
   *   - 1 分钟内：刚刚
   *   - 1 小时内：X 分钟前
   *   - 24 小时内：X 小时前
   *   - 7 天内：X 天前
   *   - 更早：显示具体日期 MM-DD（跨年则显示 YYYY-MM-DD）
   * @param {number} timestamp 毫秒时间戳
   * @returns {string}
   */
  function formatRelativeTime(timestamp) {
    if (typeof timestamp !== "number" || isNaN(timestamp)) {
      // 边界处理：非法时间戳直接返回空字符串，避免页面显示 "NaN" 或抛异常
      return "";
    }
    var now = Date.now();
    var diff = now - timestamp;
    if (diff < 0) {
      // 边界处理：时间戳在未来（极端情况，例如系统时钟被用户手动调整），兜底显示“刚刚”
      return "刚刚";
    }

    var MINUTE = 60 * 1000;
    var HOUR = 60 * MINUTE;
    var DAY = 24 * HOUR;

    if (diff < MINUTE) {
      return "刚刚";
    }
    if (diff < HOUR) {
      return Math.floor(diff / MINUTE) + " 分钟前";
    }
    if (diff < DAY) {
      return Math.floor(diff / HOUR) + " 小时前";
    }
    if (diff < 7 * DAY) {
      return Math.floor(diff / DAY) + " 天前";
    }

    var date = new Date(timestamp);
    var nowDate = new Date(now);
    var mm = String(date.getMonth() + 1).padStart(2, "0");
    var dd = String(date.getDate()).padStart(2, "0");
    if (date.getFullYear() !== nowDate.getFullYear()) {
      return date.getFullYear() + "-" + mm + "-" + dd;
    }
    return mm + "-" + dd;
  }

  /**
   * 简单转义 HTML 特殊字符，防止把用户输入/假数据直接用 innerHTML 拼接时产生 XSS。
   * Step 2 中列表标题/预览文本均通过本函数转义后再拼入 innerHTML。
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    if (str == null) {
      return "";
    }
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  window.DSFormat = {
    formatRelativeTime: formatRelativeTime,
    escapeHtml: escapeHtml
  };
})();
