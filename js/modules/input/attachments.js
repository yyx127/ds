/**
 * ============================================================
 * attachments.js —— 附件选择与本地预览（真实可用，非占位）
 * ============================================================
 * 职责范围：
 *   1. 点击「附件」按钮触发系统原生文件选择框（<input type="file">）
 *   2. 选中文件后立即在输入框上方生成预览条：图片显示缩略图，
 *      其余文件显示文件图标 + 文件名 + 大小，支持单个移除
 *   3. 所有文件只保存在内存 + 浏览器生成的本地 blob URL 中，
 *      不发起任何网络上传请求——这是「本地文件选择 + 预览」，不是「上传」
 *   4. 发送消息时，把当前待发送附件的列表随文本一起交给 chat.js；
 *      若当前 API 适配层未声明支持文件发送（config.supportsFileUpload !== true），
 *      发送前用 Toast 提示「当前模型暂不支持发送文件」，不静默丢弃、不假装发送成功
 *   5. 发送成功后清空预览条；用户也可以在发送前主动移除某个附件
 *
 * 【扩展预留位】真正把文件转成 API 能识别的格式（如 base64 图片、
 * 文件上传后换取的 file_id 等）、以及在响应解析时识别模型是否返回了
 * 处理结果，都留给后续对接具体支持多模态的厂商适配层时实现，
 * 本文件只负责「选择 -> 本地预览 -> 随消息传递文件元信息」这一段。
 * ============================================================
 */

(function () {
  "use strict";

  var el = {};

  // 当前待发送的附件列表，每项结构：
  // { id, file: File, name, size, isImage, previewUrl（图片才有，blob URL） }
  var draftAttachments = [];
  var attachmentSequence = 0;

  // 单个文件大小上限（字节），超过则拒绝加入，避免内存里堆太大的 blob 导致页面卡顿
  var MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
  // 同一条消息最多附带的文件数量
  var MAX_FILE_COUNT = 6;

  function cacheDom() {
    el.btnAttach = document.getElementById("btn-attach");
    el.filePicker = document.getElementById("input-file-picker");
    el.draftContainer = document.getElementById("draft-attachments");
  }

  /**
   * 把字节数格式化为易读的大小文本（KB/MB），仅用于展示，不要求精确到字节。
   */
  function formatFileSize(bytes) {
    if (bytes < 1024) {
      return bytes + " B";
    }
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + " KB";
    }
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  /**
   * 点击附件按钮：触发隐藏的文件选择框。
   * 不在这里做任何能力判断——选择文件本身永远允许（本地操作，不涉及网络），
   * 能力限制只在「发送」这一步生效，避免用户连预览都看不到就被拦住。
   */
  function handleAttachClick() {
    if (!el.filePicker) {
      return;
    }
    el.filePicker.click();
  }

  /**
   * 文件选择框 change 事件：把新选中的文件加入待发送列表。
   * 每次选择都是增量添加（不清空已有的），选择完成后立即清空 input.value，
   * 这样用户可以连续多次点击「附件」追加文件，且重新选择同一个文件也能再次触发 change。
   */
  function handleFilesSelected(e) {
    var files = e.target.files;
    if (!files || files.length === 0) {
      return;
    }
    var addedCount = 0;
    for (var i = 0; i < files.length; i++) {
      if (draftAttachments.length >= MAX_FILE_COUNT) {
        if (window.DSToast) {
          window.DSToast.warning("单条消息最多附带 " + MAX_FILE_COUNT + " 个文件");
        }
        break;
      }
      var file = files[i];
      if (file.size > MAX_FILE_SIZE) {
        if (window.DSToast) {
          window.DSToast.warning('"' + file.name + '" 超过 20MB，未添加');
        }
        continue;
      }
      addAttachment(file);
      addedCount += 1;
    }
    // 清空 value，确保下次选择同一文件时浏览器仍会触发 change 事件（边界处理）
    el.filePicker.value = "";
    if (addedCount > 0) {
      renderDraftAttachments();
      // 新增附件后可能让“文本为空但有附件”的消息变为可发送状态，同步一次发送按钮
      if (window.DSInput && typeof window.DSInput.syncSendButtonState === "function") {
        window.DSInput.syncSendButtonState();
      }
    }
  }

  /**
   * 将一个 File 对象包装为内部附件记录。
   * 图片类型用 URL.createObjectURL 生成本地可直接 <img> 展示的地址，
   * 不读取为 base64（更省内存，且 blob URL 天然只在本页面生命周期内有效，
   * 刷新页面后自动失效，不会残留敏感数据）。
   */
  function addAttachment(file) {
    var isImage = file.type.indexOf("image/") === 0;
    var record = {
      id: "attach-" + Date.now() + "-" + ++attachmentSequence,
      file: file,
      name: file.name,
      size: file.size,
      isImage: isImage,
      previewUrl: isImage ? URL.createObjectURL(file) : null
    };
    draftAttachments.push(record);
  }

  /**
   * 移除一个待发送附件；若是图片类型，同时释放对应的 blob URL，避免内存泄漏。
   */
  function removeAttachment(id) {
    var index = draftAttachments.findIndex(function (item) {
      return item.id === id;
    });
    if (index === -1) {
      return;
    }
    var removed = draftAttachments[index];
    if (removed.previewUrl) {
      URL.revokeObjectURL(removed.previewUrl);
    }
    draftAttachments.splice(index, 1);
    renderDraftAttachments();
    // 移除后若已没有附件且输入框也是空的，发送按钮需要重新变回禁用态
    if (window.DSInput && typeof window.DSInput.syncSendButtonState === "function") {
      window.DSInput.syncSendButtonState();
    }
  }

  /**
   * 重新渲染预览条。全量重绘：附件数量通常很少（上限 6 个），
   * 全量重绘的性能开销可以忽略，换来实现简单、不易出现增量更新遗漏的问题。
   */
  function renderDraftAttachments() {
    if (!el.draftContainer) {
      return;
    }
    el.draftContainer.innerHTML = "";

    if (draftAttachments.length === 0) {
      el.draftContainer.hidden = true;
      return;
    }
    el.draftContainer.hidden = false;

    draftAttachments.forEach(function (item) {
      el.draftContainer.appendChild(buildAttachmentChip(item));
    });

    if (window.DSIcons) {
      window.DSIcons.render(el.draftContainer);
    }
  }

  /**
   * 构建单个附件预览卡片 DOM。
   */
  function buildAttachmentChip(item) {
    var chip = document.createElement("div");
    chip.className = "attachment-chip";
    chip.dataset.id = item.id;

    if (item.isImage && item.previewUrl) {
      var img = document.createElement("img");
      img.className = "attachment-chip__thumb";
      img.src = item.previewUrl;
      img.alt = item.name;
      chip.appendChild(img);
    } else {
      var iconWrap = document.createElement("div");
      iconWrap.className = "attachment-chip__file-icon";
      var icon = document.createElement("span");
      icon.className = "icon";
      // 复用已有的回形针图标代表“文件”，不新增图标定义
      icon.setAttribute("data-icon", "attach");
      iconWrap.appendChild(icon);
      chip.appendChild(iconWrap);

      var info = document.createElement("div");
      info.className = "attachment-chip__info";
      var nameEl = document.createElement("span");
      nameEl.className = "attachment-chip__name";
      nameEl.textContent = item.name;
      nameEl.title = item.name;
      var sizeEl = document.createElement("span");
      sizeEl.className = "attachment-chip__size";
      sizeEl.textContent = formatFileSize(item.size);
      info.appendChild(nameEl);
      info.appendChild(sizeEl);
      chip.appendChild(info);
    }

    var removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "attachment-chip__remove";
    removeBtn.setAttribute("aria-label", "移除附件");
    var removeIcon = document.createElement("span");
    removeIcon.className = "icon";
    removeIcon.setAttribute("data-icon", "close");
    removeBtn.appendChild(removeIcon);
    removeBtn.addEventListener("click", function () {
      removeAttachment(item.id);
    });
    chip.appendChild(removeBtn);

    return chip;
  }

  /**
   * 供 input.js 在发送前查询：当前是否有待发送附件。
   */
  function hasDraftAttachments() {
    return draftAttachments.length > 0;
  }

  /**
   * 供 input.js 在发送前校验：当前适配的接口是否支持随消息发送文件。
   * 读取 js/core/user-config.js 提供的运行时配置（含用户在设置面板的选择 + config.js 默认值）。
   */
  function isFileSendingSupported() {
    var cfg = window.DSUserConfig ? window.DSUserConfig.getApiConfig() : null;
    return !!(cfg && cfg.supportsFileUpload === true);
  }

  /**
   * 取出当前待发送附件的只读快照（供 chat.js 挂到消息对象上用于展示），
   * 不包含 File 原始二进制引用之外的任何网络相关字段——真正的「发送给模型」
   * 转换逻辑按【扩展预留位】说明，留给后续对接具体厂商多模态格式时实现。
   */
  function getDraftAttachmentsSnapshot() {
    return draftAttachments.map(function (item) {
      return {
        id: item.id,
        name: item.name,
        size: item.size,
        isImage: item.isImage,
        previewUrl: item.previewUrl
      };
    });
  }

  /**
   * 清空待发送附件列表（发送成功后调用）。
   * 注意：这里不 revoke 图片的 blob URL——因为清空后这些附件的元信息快照
   * 仍会被 chat.js 存进消息对象用于气泡展示，blob URL 需要继续有效；
   * 只有用户主动点「移除」时才会释放对应的 URL（见 removeAttachment）。
   */
  function clearDraftAttachments() {
    draftAttachments = [];
    renderDraftAttachments();
  }

  function init() {
    cacheDom();
    if (!el.btnAttach || !el.filePicker) {
      console.warn("[DSAttachments] 未找到附件按钮或文件选择框节点，附件功能未初始化。");
      return;
    }
    el.btnAttach.addEventListener("click", handleAttachClick);
    el.filePicker.addEventListener("change", handleFilesSelected);
    console.log("[DSAttachments] 初始化完成：支持本地文件选择与预览，发送能力受当前接口配置的 supportsFileUpload 开关限制。");
  }

  window.DSAttachments = {
    init: init,
    hasDraftAttachments: hasDraftAttachments,
    isFileSendingSupported: isFileSendingSupported,
    getDraftAttachmentsSnapshot: getDraftAttachmentsSnapshot,
    clearDraftAttachments: clearDraftAttachments
  };
})();
