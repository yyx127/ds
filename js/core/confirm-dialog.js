/**
 * ============================================================
 * confirm-dialog.js —— 通用二次确认弹窗模块（核心基础设施）
 * ============================================================
 * 用于「清空全部对话」「删除对话」等需要二次确认的危险操作。
 * 与设置面板/等其他弹窗共用 css/settings.css 中定义的 .modal 通用样式，
 * 动态创建 DOM，调用结束后自动销毁，不污染 index.html 静态结构。
 *
 * 用法：
 *   window.DSConfirm.show({
 *     title: '删除对话',
 *     message: '删除后将无法恢复，确定要删除该对话吗？',
 *     confirmText: '删除',
 *     danger: true
 *   }).then(function (ok) {
 *     if (ok) { // 用户点击了确认按钮 }
 *   });
 * ============================================================
 */

(function () {
  "use strict";

  /**
   * 显示确认弹窗，返回一个 Promise<boolean>：
   * 用户点击「确认」resolve(true)，点击「取消」/遮罩/ESC resolve(false)。
   * @param {Object} opts
   * @param {string} opts.title 标题
   * @param {string} opts.message 正文说明
   * @param {string} [opts.confirmText] 确认按钮文字，默认“确认”
   * @param {string} [opts.cancelText] 取消按钮文字，默认“取消”
   * @param {boolean} [opts.danger] 是否危险操作（确认按钮使用警示色）
   * @returns {Promise<boolean>}
   */
  function show(opts) {
    opts = opts || {};
    var title = opts.title || "请确认";
    var message = opts.message || "";
    var confirmText = opts.confirmText || "确认";
    var cancelText = opts.cancelText || "取消";
    var danger = !!opts.danger;

    return new Promise(function (resolve) {
      // ---- 动态构建 DOM 结构 ----
      var modal = document.createElement("div");
      modal.className = "modal confirm-dialog";

      var mask = document.createElement("div");
      mask.className = "modal__mask";

      var panel = document.createElement("div");
      panel.className = "modal__panel confirm-dialog__panel";
      panel.setAttribute("role", "alertdialog");
      panel.setAttribute("aria-modal", "true");

      var titleEl = document.createElement("div");
      titleEl.className = "confirm-dialog__title";
      titleEl.textContent = title;

      var msgEl = document.createElement("div");
      msgEl.className = "confirm-dialog__message";
      msgEl.textContent = message;

      var actions = document.createElement("div");
      actions.className = "confirm-dialog__actions";

      var btnCancel = document.createElement("button");
      btnCancel.type = "button";
      btnCancel.className = "confirm-dialog__btn confirm-dialog__btn--cancel";
      btnCancel.textContent = cancelText;

      var btnConfirm = document.createElement("button");
      btnConfirm.type = "button";
      btnConfirm.className =
        "confirm-dialog__btn confirm-dialog__btn--confirm" +
        (danger ? " confirm-dialog__btn--danger" : "");
      btnConfirm.textContent = confirmText;

      actions.appendChild(btnCancel);
      actions.appendChild(btnConfirm);
      panel.appendChild(titleEl);
      panel.appendChild(msgEl);
      panel.appendChild(actions);
      modal.appendChild(mask);
      modal.appendChild(panel);
      document.body.appendChild(modal);

      // 下一帧触发进入动画（配合 settings.css 中 .modal__mask / .modal__panel 的 transition）
      requestAnimationFrame(function () {
        modal.classList.add("is-open");
      });

      function cleanup(result) {
        modal.classList.remove("is-open");
        setTimeout(function () {
          if (modal.parentNode) {
            modal.parentNode.removeChild(modal);
          }
        }, 200);
        document.removeEventListener("keydown", onKeydown);
        resolve(result);
      }

      function onKeydown(e) {
        // ESC 键关闭弹窗，等同取消，属于边界操作处理的一部分
        if (e.key === "Escape") {
          cleanup(false);
        }
      }

      btnCancel.addEventListener("click", function () {
        cleanup(false);
      });
      btnConfirm.addEventListener("click", function () {
        cleanup(true);
      });
      // 点击遮罩视为取消，与大多数弹窗交互习惯一致
      mask.addEventListener("click", function () {
        cleanup(false);
      });
      document.addEventListener("keydown", onKeydown);

      // 自动聚焦到确认按钮，提升键盘可访问性
      btnConfirm.focus();
    });
  }

  window.DSConfirm = {
    show: show
  };
})();
