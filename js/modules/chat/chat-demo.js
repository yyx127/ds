/**
 * ============================================================
 * chat-demo.js —— 聊天区消息渲染工具库（Step 4：升级为纯工具模块）
 * ============================================================
 * 【演进说明】
 * Step 3 阶段本文件曾经「自带一份写死的示例消息并在 init() 时自动渲染」，
 * 用于单独验证气泡/思考面板/加载动效等视觉效果。
 * 从 Step 4 开始，聊天区的真实消息状态由 js/modules/chat/chat.js 统一管理
 * （内存态的每对话消息数组、发送/接收/重新生成/清空等业务流程），
 * 本文件退化为「纯函数工具库」：只负责把一个消息数据对象，转换成对应的
 * DOM 节点，或者把一段 Markdown 文本转换成安全的 HTML 字符串。
 * 不再包含任何自动渲染、不再持有消息状态、不再绑定固定不变的按钮行为——
 * 所有消息操作按钮的点击行为，现在都通过构建函数的 `handlers` 参数回调出去，
 * 由调用方（chat.js）决定具体做什么（例如“复制”“重新生成”“编辑后重发”）。
 *
 * 仍不接入任何真实 API、不做本地持久化——这两项分别在后续的
 * API 适配层 Step 与本地持久化 Step 中实现。
 * ============================================================
 */

(function () {
  "use strict";

  // ================================================================
  // Markdown / 代码高亮 / 公式渲染封装
  // ================================================================

  /**
   * 将 Markdown 文本安全渲染为 HTML 字符串。
   * - 使用 marked 解析 Markdown 结构
   * - 使用 highlight.js 对代码块做语法高亮（通过 marked 的 renderer 钩子接入）
   * - 关闭 marked 的原始 HTML 直通能力，加强 XSS 防护（配合 marked 默认的转义行为）
   * @param {string} raw 原始 Markdown 文本
   * @returns {string} 安全的 HTML 字符串
   */
  function renderMarkdown(raw) {
    if (!raw) {
      return "";
    }
    if (!window.marked) {
      // 边界处理：marked 库未加载成功时，退化为纯文本展示（转义后保留换行）
      var escaped = window.DSFormat ? window.DSFormat.escapeHtml(raw) : raw;
      return '<p style="white-space:pre-wrap">' + escaped + "</p>";
    }

    // 配置 marked：关闭原始 HTML 穿透（安全模式），代码块交由自定义 renderer 处理高亮
    var renderer = new window.marked.Renderer();
    renderer.code = function (code, infostring) {
      var lang = (infostring || "").trim().split(/\s+/)[0] || "";
      var highlighted = "";
      try {
        if (window.hljs && lang && window.hljs.getLanguage(lang)) {
          highlighted = window.hljs.highlight(code, { language: lang }).value;
        } else if (window.hljs) {
          highlighted = window.hljs.highlightAuto(code).value;
        } else {
          highlighted = window.DSFormat ? window.DSFormat.escapeHtml(code) : code;
        }
      } catch (err) {
        // 边界处理：高亮失败不影响整体渲染，退化为转义后的纯文本
        console.warn("[DSChatRender] 代码高亮失败：", err);
        highlighted = window.DSFormat ? window.DSFormat.escapeHtml(code) : code;
      }
      var langLabel = lang || "text";
      // 代码块外层包一层带「语言标签 + 复制按钮」的容器，复制按钮的点击事件在渲染完成后统一绑定
      return (
        '<div class="code-block" data-raw-code="' +
        encodeURIComponent(code) +
        '">' +
        '<div class="code-block__header">' +
        '<span class="code-block__lang">' +
        (window.DSFormat ? window.DSFormat.escapeHtml(langLabel) : langLabel) +
        "</span>" +
        '<button type="button" class="code-block__copy-btn" data-action="copy-code">' +
        '<span class="icon" data-icon="copy"></span><span>复制</span>' +
        "</button>" +
        "</div>" +
        "<pre><code class=\"hljs language-" +
        langLabel +
        '">' +
        highlighted +
        "</code></pre>" +
        "</div>"
      );
    };

    window.marked.setOptions({
      renderer: renderer,
      breaks: true, // 支持单换行即换行，更贴近聊天场景的排版习惯
      gfm: true // 支持 GitHub 风格 Markdown（表格、删除线等）
    });

    return window.marked.parse(raw);
  }

  /**
   * 对渲染后的 HTML 中的 LaTeX 公式片段做 KaTeX 渲染。
   * 约定：行内公式用 $...$ 包裹，块级公式用 $$...$$ 包裹。
   * 采用渲染完成后再对纯文本节点做二次扫描替换的简化策略，覆盖常见公式展示场景。
   * @param {HTMLElement} container 已经写入 Markdown 渲染结果的容器节点
   */
  function renderMathFormulas(container) {
    if (!window.katex) {
      return;
    }
    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
    var textNodes = [];
    var node;
    while ((node = walker.nextNode())) {
      if (/\$/.test(node.nodeValue)) {
        textNodes.push(node);
      }
    }
    textNodes.forEach(function (textNode) {
      var text = textNode.nodeValue;
      var fragments = [];
      var lastIndex = 0;
      var regex = /\$\$([^$]+?)\$\$|\$([^$]+?)\$/g;
      var match;
      var hasMatch = false;
      while ((match = regex.exec(text)) !== null) {
        hasMatch = true;
        if (match.index > lastIndex) {
          fragments.push(document.createTextNode(text.slice(lastIndex, match.index)));
        }
        var isBlock = typeof match[1] === "string";
        var formula = isBlock ? match[1] : match[2];
        var span = document.createElement("span");
        try {
          window.katex.render(formula, span, { throwOnError: false, displayMode: isBlock });
        } catch (err) {
          span.textContent = match[0];
        }
        fragments.push(span);
        lastIndex = regex.lastIndex;
      }
      if (!hasMatch) {
        return;
      }
      if (lastIndex < text.length) {
        fragments.push(document.createTextNode(text.slice(lastIndex)));
      }
      var parent = textNode.parentNode;
      fragments.forEach(function (frag) {
        parent.insertBefore(frag, textNode);
      });
      parent.removeChild(textNode);
    });
  }

  /**
   * 绑定代码块复制按钮的点击事件（事件委托到容器上，避免对每个代码块单独绑定）。
   * 可在任意包含代码块的容器上调用一次。
   */
  function bindCodeCopyEvents(container) {
    container.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest('[data-action="copy-code"]') : null;
      if (!btn) {
        return;
      }
      var codeBlock = btn.closest(".code-block");
      if (!codeBlock) {
        return;
      }
      var raw = decodeURIComponent(codeBlock.getAttribute("data-raw-code") || "");
      copyTextToClipboard(raw).then(function (ok) {
        if (window.DSToast) {
          ok ? window.DSToast.success("代码已复制") : window.DSToast.error("复制失败，请手动选择复制");
        }
      });
    });
  }

  /**
   * 通用复制到剪贴板封装，优先使用 navigator.clipboard（Safari 14+ 支持），
   * 失败时降级为 execCommand('copy') 兼容旧版浏览器/非安全上下文（http）场景。
   * @param {string} text
   * @returns {Promise<boolean>}
   */
  function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () {
          return true;
        },
        function () {
          return fallbackCopy(text);
        }
      );
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    try {
      var textarea = document.createElement("textarea");
      textarea.value = text;
      // 移出可视区域，避免在移动端触发键盘弹出或页面跳动
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      return ok;
    } catch (err) {
      return false;
    }
  }

  // ================================================================
  // 消息 DOM 构建函数
  // ================================================================
  // 说明：以下构建函数不再在内部绑定固定行为，而是通过 handlers 参数把
  // “用户点击了哪个操作按钮”这一事件回调给调用方（chat.js），
  // 由调用方决定具体的业务逻辑（复制/编辑重发/重新生成/点赞点踩等）。
  // handlers 的约定形状：
  // {
  //   onCopy?: (msg) => void,
  //   onEdit?: (msg, rowEl) => void,
  //   onRegenerate?: (msg, rowEl) => void,
  //   onLike?: (msg, btnEl) => void,
  //   onDislike?: (msg, btnEl) => void
  // }

  /**
   * 构建已发送消息里的附件展示区（气泡内，位于文字上方）。
   * @param {Array} files 附件元信息数组，结构见 js/modules/input/attachments.js 的 getDraftAttachmentsSnapshot
   */
  function buildMessageFilesPreview(files) {
    var wrap = document.createElement("div");
    wrap.className = "message-bubble__files";
    files.forEach(function (file) {
      if (file.isImage && file.previewUrl) {
        var img = document.createElement("img");
        img.className = "message-bubble__file-thumb";
        img.src = file.previewUrl;
        img.alt = file.name;
        wrap.appendChild(img);
      } else {
        var chip = document.createElement("span");
        chip.className = "message-bubble__file-chip";
        var icon = document.createElement("span");
        icon.className = "icon";
        icon.setAttribute("data-icon", "attach");
        var nameEl = document.createElement("span");
        nameEl.textContent = file.name;
        chip.appendChild(icon);
        chip.appendChild(nameEl);
        wrap.appendChild(chip);
      }
    });
    return wrap;
  }

  /**
   * 构建"分支切换器"：当一条消息存在多个兄弟版本（重新生成/编辑产生的分支）时，
   * 显示 "‹ 当前序号/总数 ›" 的小控件，点左右箭头切换到对应的兄弟版本；
   * 只有一个版本（没有分支）时不渲染任何内容——移植自官方 BranchSwitcher.tsx 的交互设计。
   * @param {{ids: string[], index: number}|undefined} versions
   * @param {(messageId: string) => void} onSelect
   * @returns {HTMLElement|null} 没有分支时返回 null，调用方应判空后决定是否插入 DOM
   */
  function buildBranchSwitcher(versions, onSelect) {
    if (!versions || !Array.isArray(versions.ids) || versions.ids.length <= 1) {
      return null;
    }
    var ids = versions.ids;
    var index = versions.index;

    var switcher = document.createElement("div");
    switcher.className = "branch-switcher";
    switcher.dataset.messageVersion = ids[index];

    var prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "branch-switcher__btn branch-switcher__btn--prev";
    prevBtn.setAttribute("aria-label", "上一个版本");
    prevBtn.disabled = index <= 0;
    var prevIcon = document.createElement("span");
    prevIcon.className = "icon";
    prevIcon.setAttribute("data-icon", "chevron-left");
    prevBtn.appendChild(prevIcon);
    prevBtn.addEventListener("click", function () {
      if (index > 0 && typeof onSelect === "function") {
        onSelect(ids[index - 1]);
      }
    });

    var countEl = document.createElement("span");
    countEl.className = "branch-switcher__count";
    countEl.textContent = (index + 1) + " / " + ids.length;

    var nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "branch-switcher__btn branch-switcher__btn--next";
    nextBtn.setAttribute("aria-label", "下一个版本");
    nextBtn.disabled = index >= ids.length - 1;
    var nextIcon = document.createElement("span");
    nextIcon.className = "icon";
    nextIcon.setAttribute("data-icon", "chevron-right");
    nextBtn.appendChild(nextIcon);
    nextBtn.addEventListener("click", function () {
      if (index < ids.length - 1 && typeof onSelect === "function") {
        onSelect(ids[index + 1]);
      }
    });

    switcher.appendChild(prevBtn);
    switcher.appendChild(countEl);
    switcher.appendChild(nextBtn);
    return switcher;
  }

  /**
   * 在已经渲染好的消息行上就地更新分支切换器（重新生成/切换完成后调用），
   * 不需要整体重绘这一行。没有切换器但现在需要显示时会新建并插入；
   * 已有切换器但现在不再需要（版本数又变回 1 个，理论上不会发生，仅做防御）时会移除。
   * @param {HTMLElement} row
   * @param {{ids: string[], index: number}|undefined} versions
   * @param {(messageId: string) => void} onSelect
   */
  function updateBranchSwitcher(row, versions, onSelect) {
    var existing = row.querySelector(".branch-switcher");
    var next = buildBranchSwitcher(versions, onSelect);
    if (existing && next) {
      existing.replaceWith(next);
    } else if (existing && !next) {
      existing.remove();
    } else if (!existing && next) {
      var actions = row.querySelector(".message-actions");
      if (actions) {
        actions.insertAdjacentElement("afterend", next);
      } else {
        row.querySelector(".message-col").appendChild(next);
      }
    }
    if (next && window.DSIcons) {
      window.DSIcons.render(next);
    }
  }

  /**
   * 构建用户消息行。
   * @param {Object} msg { id, content, files }
   * @param {Object} [handlers] 额外支持 { versions, onSelectVersion } 用于渲染分支切换器
   */
  function buildUserMessage(msg, handlers) {
    handlers = handlers || {};
    var row = document.createElement("div");
    row.className = "message-row message-row--user";
    row.dataset.id = msg.id;

    var col = document.createElement("div");
    col.className = "message-col";

    var bubble = document.createElement("div");
    bubble.className = "message-bubble";

    // 附件展示：图片渲染缩略图，其余文件渲染图标+文件名小标签；没有附件时不渲染任何内容
    if (Array.isArray(msg.files) && msg.files.length > 0) {
      bubble.appendChild(buildMessageFilesPreview(msg.files));
    }

    // 文字内容为空（例如只发了一张图没配文字）时不渲染空的文本节点，避免气泡出现多余空行
    if (msg.content) {
      var textEl = document.createElement("div");
      textEl.className = "message-bubble__text";
      // 用户原文使用 textContent 保证不被解析为 HTML/Markdown，纯文本安全展示
      textEl.textContent = msg.content;
      bubble.appendChild(textEl);
    }

    var actions = document.createElement("div");
    actions.className = "message-actions";
    actions.appendChild(buildActionButton("copy", "复制", "copy"));
    actions.appendChild(buildActionButton("edit", "编辑", "edit"));

    col.appendChild(bubble);
    col.appendChild(actions);

    // 分支切换器：挂在同一行的用户消息有多个版本时显示（编辑产生的新分支）
    var switcher = buildBranchSwitcher(handlers.versions, handlers.onSelectVersion);
    if (switcher) {
      col.appendChild(switcher);
    }

    row.appendChild(col);

    row.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest(".message-actions__btn") : null;
      if (!btn) {
        return;
      }
      var action = btn.dataset.action;
      if (action === "copy") {
        copyTextToClipboard(msg.content).then(function (ok) {
          if (window.DSToast) {
            ok ? window.DSToast.success("已复制") : window.DSToast.error("复制失败");
          }
        });
      } else if (action === "edit" && typeof handlers.onEdit === "function") {
        handlers.onEdit(msg, row);
      }
    });

    return row;
  }

  /**
   * 构建 AI 消息行（可能包含：思考面板 + 正文 Markdown + 操作按钮）。
   * @param {Object} msg { id, thinking, content }
   * @param {Object} [handlers]
   */
  function buildAssistantMessage(msg, handlers) {
    handlers = handlers || {};
    var row = document.createElement("div");
    row.className = "message-row message-row--assistant";
    row.dataset.id = msg.id;

    var col = document.createElement("div");
    col.className = "message-col";

    // 深度思考折叠面板：仅当消息存在 thinking 字段且非空时才渲染
    if (msg.thinking) {
      col.appendChild(buildThinkingPanel(msg.thinking));
    }

    var bubble = document.createElement("div");
    bubble.className = "message-bubble markdown-body";
    bubble.innerHTML = renderMarkdown(msg.content);
    renderMathFormulas(bubble);

    var actions = buildAssistantActionsBar(msg, row, handlers);

    col.appendChild(bubble);
    col.appendChild(actions);

    // 分支切换器：这条 AI 回复有多个版本时显示（重新生成产生的新分支）
    var switcher = buildBranchSwitcher(handlers.versions, handlers.onSelectVersion);
    if (switcher) {
      col.appendChild(switcher);
    }

    row.appendChild(col);

    if (window.DSIcons) {
      window.DSIcons.render(col);
    }
    bindCodeCopyEvents(bubble);

    return row;
  }

  /**
   * 构建 AI 消息的操作按钮栏（复制/重新生成/点赞/点踩），并绑定事件回调。
   * 独立成函数是因为“演示性流式回复结束后”也需要补一条同样的操作栏（在 chat.js 中复用）。
   * @param {Object} msg
   * @param {HTMLElement} row 消息行节点（用于 handlers 回调时定位/更新）
   * @param {Object} handlers
   */
  function buildAssistantActionsBar(msg, row, handlers) {
    handlers = handlers || {};
    var actions = document.createElement("div");
    actions.className = "message-actions";
    actions.appendChild(buildActionButton("copy", "复制", "copy"));
    actions.appendChild(buildActionButton("refresh", "重新生成", "regenerate"));
    actions.appendChild(buildActionButton("thumb-up", "点赞", "like"));
    actions.appendChild(buildActionButton("thumb-down", "点踩", "dislike"));

    actions.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest(".message-actions__btn") : null;
      if (!btn) {
        return;
      }
      var action = btn.dataset.action;
      if (action === "copy") {
        copyTextToClipboard(msg.content).then(function (ok) {
          if (window.DSToast) {
            ok ? window.DSToast.success("已复制") : window.DSToast.error("复制失败");
          }
        });
      } else if (action === "regenerate" && typeof handlers.onRegenerate === "function") {
        handlers.onRegenerate(msg, row);
      } else if (action === "like") {
        var wasSelected = btn.classList.contains("is-selected");
        btn.classList.toggle("is-selected");
        var dislikeBtn = actions.querySelector('[data-action="dislike"]');
        if (!wasSelected && dislikeBtn) {
          dislikeBtn.classList.remove("is-selected");
        }
        if (typeof handlers.onLike === "function") {
          handlers.onLike(msg, btn, !wasSelected);
        }
      } else if (action === "dislike") {
        var wasSelectedD = btn.classList.contains("is-selected");
        btn.classList.toggle("is-selected");
        var likeBtn = actions.querySelector('[data-action="like"]');
        if (!wasSelectedD && likeBtn) {
          likeBtn.classList.remove("is-selected");
        }
        if (typeof handlers.onDislike === "function") {
          handlers.onDislike(msg, btn, !wasSelectedD);
        }
      }
    });

    return actions;
  }

  /**
   * 构建深度思考折叠面板。默认收起态，点击头部展开/收起。
   * 样式与 DeepSeek 官方思考块保持一致：浅灰底卡片，灯泡图标 + “已深度思考”文案 + 展开箭头。
   * @param {string} thinkingText
   */
  function buildThinkingPanel(thinkingText) {
    var panel = document.createElement("div");
    panel.className = "thinking-panel";

    var header = document.createElement("div");
    header.className = "thinking-panel__header";

    var icon = document.createElement("span");
    icon.className = "icon";
    icon.setAttribute("data-icon", "thinking");

    var title = document.createElement("span");
    title.className = "thinking-panel__title";
    title.textContent = "已深度思考";

    var arrow = document.createElement("span");
    arrow.className = "icon thinking-panel__arrow";
    arrow.setAttribute("data-icon", "expand");

    header.appendChild(icon);
    header.appendChild(title);
    header.appendChild(arrow);

    var body = document.createElement("div");
    body.className = "thinking-panel__body";
    var content = document.createElement("div");
    content.className = "thinking-panel__content";
    content.textContent = thinkingText;
    body.appendChild(content);

    panel.appendChild(header);
    panel.appendChild(body);

    // 点击头部切换展开/收起态，默认保持收起（不添加 is-expanded）
    header.addEventListener("click", function () {
      panel.classList.toggle("is-expanded");
    });

    return panel;
  }

  /**
   * 构建“AI 正在思考/生成中”的加载行（三点动效）。
   * @param {string} [rowId] 可选的行节点 id，方便调用方后续查找并替换/移除该行
   */
  function buildLoadingMessage(rowId) {
    var row = document.createElement("div");
    row.className = "message-row message-row--assistant";
    if (rowId) {
      row.id = rowId;
    }

    var col = document.createElement("div");
    col.className = "message-col";

    var bubble = document.createElement("div");
    bubble.className = "message-bubble";

    var dots = document.createElement("div");
    dots.className = "loading-dots";
    for (var i = 0; i < 3; i++) {
      var dot = document.createElement("span");
      dot.className = "loading-dots__dot";
      dots.appendChild(dot);
    }
    bubble.appendChild(dots);
    col.appendChild(bubble);
    row.appendChild(col);
    return row;
  }

  /**
   * 构建单个消息操作按钮。
   * @param {string} iconName
   * @param {string} label
   * @param {string} action 标记按钮用途，供事件处理分支判断
   */
  function buildActionButton(iconName, label, action) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "message-actions__btn";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.dataset.action = action;
    var icon = document.createElement("span");
    icon.className = "icon";
    icon.setAttribute("data-icon", iconName);
    btn.appendChild(icon);
    return btn;
  }

  /**
   * 构建用户消息的编辑态 DOM（可编辑文本框 + 保存/取消按钮），插入到指定位置。
   * 抽成工具函数供 chat.js 调用，具体“保存后做什么”由调用方的回调决定。
   * @param {string} initialValue
   * @param {(newValue: string) => void} onSave 点击“保存并重新发送”时回调，newValue 已做非空校验
   * @param {() => void} onCancel 点击“取消”时回调
   * @returns {HTMLElement}
   */
  function buildEditBox(initialValue, onSave, onCancel) {
    var editBox = document.createElement("div");
    editBox.className = "message-edit-box";

    var textarea = document.createElement("textarea");
    textarea.className = "message-edit-box__textarea";
    textarea.value = initialValue;

    var actionsBar = document.createElement("div");
    actionsBar.className = "message-edit-box__actions";

    var btnCancel = document.createElement("button");
    btnCancel.type = "button";
    btnCancel.className = "message-edit-box__btn message-edit-box__btn--cancel";
    btnCancel.textContent = "取消";

    var btnSave = document.createElement("button");
    btnSave.type = "button";
    btnSave.className = "message-edit-box__btn message-edit-box__btn--save";
    btnSave.textContent = "保存并重新发送";

    actionsBar.appendChild(btnCancel);
    actionsBar.appendChild(btnSave);
    editBox.appendChild(textarea);
    editBox.appendChild(actionsBar);

    btnCancel.addEventListener("click", function () {
      if (typeof onCancel === "function") {
        onCancel();
      }
    });
    btnSave.addEventListener("click", function () {
      var newText = textarea.value.trim();
      if (!newText) {
        if (window.DSToast) {
          window.DSToast.warning("消息内容不能为空");
        }
        return;
      }
      if (typeof onSave === "function") {
        onSave(newText);
      }
    });

    // 暴露 textarea 引用，方便调用方插入 DOM 后聚焦
    editBox.__textarea = textarea;

    return editBox;
  }

  window.DSChatDemo = {
    // 构建函数
    buildUserMessage: buildUserMessage,
    buildAssistantMessage: buildAssistantMessage,
    buildAssistantActionsBar: buildAssistantActionsBar,
    buildThinkingPanel: buildThinkingPanel,
    buildLoadingMessage: buildLoadingMessage,
    buildActionButton: buildActionButton,
    buildEditBox: buildEditBox,
    buildBranchSwitcher: buildBranchSwitcher,
    updateBranchSwitcher: updateBranchSwitcher,
    // 渲染与工具函数
    renderMarkdown: renderMarkdown,
    renderMathFormulas: renderMathFormulas,
    bindCodeCopyEvents: bindCodeCopyEvents,
    copyTextToClipboard: copyTextToClipboard
  };
})();
