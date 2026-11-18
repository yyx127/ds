/**
 * ============================================================
 * import-file.js —— 导入外部文本/聊天记录并自动压缩为新对话开场
 * ============================================================
 * 职责：
 *   1. 点击「导入文件」按钮，读取本地 .txt / .md 文件的完整文本内容
 *   2. 把整段文本当作一次性的"待压缩历史"，交给 js/core/compression.js
 *      的压缩引擎（算法移植自 DeepSeek Harness 官方实现）生成一份结构化摘要
 *   3. 用这份摘要作为新对话的第一条消息（checkpoint 形式），新建并切换到
 *      这个对话，后续用户可以直接在这份背景之上继续聊天/角色扮演，
 *      不需要把原始长文本整段粘贴进输入框占满上下文
 *
 * 导入的文本本身不会被当成一条条真实的用户/AI 消息逐条导入——它通常是
 * 外部来源的完整记录（小说草稿、角色扮演历史导出等），没有清晰的
 * user/assistant 轮次边界，因此统一包装成一条 role: 'user' 的长文本消息，
 * 交给同一套压缩逻辑处理（压缩引擎本身不关心消息条数，只关心总 token 量）。
 * ============================================================
 */

(function () {
  "use strict";

  var el = {};

  // 单个导入文件的大小上限（字节），超过则拒绝读取，避免读入过大的文件导致页面卡顿
  var MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024; // 5MB，纯文本场景下已经是相当大的篇幅

  function cacheDom() {
    el.btnImport = document.getElementById("btn-import-file");
    el.filePicker = document.getElementById("import-file-picker");
  }

  function handleImportClick() {
    if (!el.filePicker) {
      return;
    }
    el.filePicker.click();
  }

  /**
   * 用浏览器原生 FileReader 读取文件文本内容（纯文本/Markdown，不需要任何第三方库）。
   * @param {File} file
   * @returns {Promise<string>}
   */
  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.onerror = function () {
        reject(reader.error || new Error("文件读取失败"));
      };
      reader.readAsText(file, "utf-8");
    });
  }

  function handleFileSelected(e) {
    var file = e.target.files && e.target.files[0];
    el.filePicker.value = "";
    if (!file) {
      return;
    }
    if (file.size > MAX_IMPORT_FILE_SIZE) {
      if (window.DSToast) {
        window.DSToast.warning("文件过大（超过 5MB），请先拆分后再导入");
      }
      return;
    }
    if (!window.DSCompression || !window.DSApiClient) {
      if (window.DSToast) {
        window.DSToast.error("压缩引擎未加载，无法导入");
      }
      return;
    }
    if (!window.DSUserConfig || !window.DSUserConfig.isApiConfigReady()) {
      if (window.DSToast) {
        window.DSToast.warning("导入需要先在设置中配置 API 地址与模型名称（用于生成摘要）");
      }
      return;
    }

    var hideLoading = window.DSToast ? window.DSToast.loading("正在读取并压缩文件内容…") : null;
    // 承接读到的原文，供下面"压缩判定为不需要压缩"时直接用作开场消息内容
    var lastReadText = "";

    readFileAsText(file)
      .then(function (text) {
        var trimmed = text.trim();
        if (!trimmed) {
          throw new Error("文件内容为空");
        }
        lastReadText = trimmed;
        // 包装成一条长文本 user 消息，交给压缩引擎；force: true 跳过压力阈值判断，
        // 导入场景下只要有内容就应该生成摘要，不需要等到"占用够多上下文"才处理。
        var wrapped = [{ id: "import-source", role: "user", content: trimmed }];
        var cfg = window.DSCompressionSettings ? window.DSCompressionSettings.getConfig() : {};
        return window.DSCompression.compactMessages(wrapped, Object.assign({}, cfg, { force: true }));
      })
      .then(function (result) {
        if (hideLoading) {
          hideLoading();
        }
        if (!result.compacted) {
          // 文件内容本身很短，压缩没有意义（摘要不会比原文更小）：直接把原文整段作为开场消息导入，
          // 不强行套用压缩流程——用户仍然得到了"文件内容变成新对话"的结果，只是没有被摘要化。
          // 这里拿不到压缩引擎返回的原文了（新版 compactMessages 不再把 messages 传回来），
          // 改成自己重新读一次已经拿到的 trimmed 文本——见下面用闭包变量承接。
          createImportedConversation(file.name, [
            { id: "import-" + Date.now(), role: "user", content: lastReadText }
          ]);
          if (window.DSToast) {
            window.DSToast.success("已导入「" + file.name + "」（内容较短，未压缩）");
          }
          return;
        }
        // 压缩成功：导入场景下没有"原始消息 id"需要保留（这是全新对话的开场，
        // 不是对一个已有对话做压缩），直接把摘要包裹成一条完整的开场消息即可，
        // 不需要走"压缩记录 + 按需替换"这一套（那是给"已有对话、要继续聊"用的）。
        var framed = window.DSCompression.frameSummary(result.summary);
        createImportedConversation(file.name, [
          { id: "import-" + Date.now(), role: "user", content: framed }
        ]);
        if (window.DSToast) {
          window.DSToast.success("已导入并压缩「" + file.name + "」，新对话已创建");
        }
      })
      .catch(function (err) {
        if (hideLoading) {
          hideLoading();
        }
        console.error("[DSImportFile] 导入失败：", err);
        if (window.DSToast) {
          window.DSToast.error("导入失败：" + (err && err.message ? err.message : "未知错误"));
        }
      });
  }

  /**
   * 用压缩结果（通常是单条 checkpoint 消息）新建一个对话并切换过去。
   * @param {string} fileName
   * @param {Array} messages
   */
  function createImportedConversation(fileName, messages) {
    if (!window.DSSidebar || typeof window.DSSidebar.createConversationWithMessages !== "function") {
      return;
    }
    // 标题截断：去掉扩展名，超长文件名裁剪，避免撑破侧边栏列表项布局
    var title = fileName.replace(/\.[^./\\]+$/, "");
    if (title.length > 24) {
      title = title.slice(0, 24) + "…";
    }
    window.DSSidebar.createConversationWithMessages("导入：" + title, messages);
  }

  function init() {
    cacheDom();
    if (!el.btnImport || !el.filePicker) {
      console.warn("[DSImportFile] 未找到导入按钮或文件选择框节点，导入功能未初始化。");
      return;
    }
    el.btnImport.addEventListener("click", handleImportClick);
    el.filePicker.addEventListener("change", handleFileSelected);
    console.log("[DSImportFile] 初始化完成：支持导入 txt/md 文本并自动压缩为新对话开场摘要。");
  }

  window.DSImportFile = {
    init: init
  };
})();
