/**
 * ============================================================
 * settings.js —— 设置面板（多分区：API 设置 / 外观）
 * ============================================================
 * 【演进说明】
 * Step 5 阶段本文件只有「API 设置」一个分区。本次新增「外观」分区
 * （深浅色切换、配色包选择、自定义配色拾色器），把面板改成了
 * 左侧/顶部 Tab 切换的结构；原有 API 设置的全部字段、保存/恢复默认
 * 逻辑原样保留，只是从“唯一内容”变成“其中一个 Tab 的内容”。
 * 其余分区（对话/压缩/关于与数据等）留给后续 Step 继续按同样方式扩展。
 *
 * 不做任何数据持久化之外的事情；API 配置依赖 js/core/user-config.js，
 * 外观配置依赖 js/core/theme.js，本文件只负责把这两者接到可视化表单上。
 * ============================================================
 */

(function () {
  "use strict";

  var el = {};
  var currentTab = "api";

  function cacheDom() {
    el.modal = document.getElementById("settings-modal");
    el.mask = document.getElementById("settings-modal-mask");
    el.panel = document.querySelector("#settings-modal .settings-panel");
    el.btnOpen = document.getElementById("btn-open-settings");
  }

  /**
   * 构建设置面板内部 DOM（Tab 导航 + 两个分区内容 + 操作按钮），仅在首次打开时构建一次并缓存，
   * 避免重复创建节点；两个分区的内容一次性全部渲染出来，用 hidden 属性切换显示，
   * 不做“切换 Tab 时才创建 DOM”的懒加载——分区内容量很小，没必要为此增加复杂度。
   */
  function buildPanelContent() {
    if (!el.panel || el.panel.childElementCount > 0) {
      return;
    }

    el.panel.innerHTML =
      '<div class="settings-panel__header">' +
      '  <div class="settings-panel__title">设置</div>' +
      '  <button type="button" id="btn-close-settings" class="icon-btn" aria-label="关闭设置">' +
      '    <span class="icon" data-icon="close"></span>' +
      "  </button>" +
      "</div>" +
      '<div class="settings-tabs" role="tablist">' +
      '  <button type="button" class="settings-tab is-active" data-tab="api" role="tab" aria-selected="true">API 设置</button>' +
      '  <button type="button" class="settings-tab" data-tab="appearance" role="tab" aria-selected="false">外观</button>' +
      '  <button type="button" class="settings-tab" data-tab="background" role="tab" aria-selected="false">背景</button>' +
      '  <button type="button" class="settings-tab" data-tab="compression" role="tab" aria-selected="false">对话压缩</button>' +
      "</div>" +
      '<div class="settings-panel__body">' +
      buildApiTabHtml() +
      buildAppearanceTabHtml() +
      buildBackgroundTabHtml() +
      buildCompressionTabHtml() +
      "</div>" +
      '<div class="settings-panel__footer">' +
      '  <button type="button" id="btn-settings-reset" class="confirm-dialog__btn confirm-dialog__btn--cancel">恢复默认</button>' +
      '  <button type="button" id="btn-settings-save" class="confirm-dialog__btn confirm-dialog__btn--confirm">保存</button>' +
      "</div>";

    if (window.DSIcons) {
      window.DSIcons.render(el.panel);
    }

    bindPanelEvents();
    renderThemePacks();
    syncCustomColorInputsFromState();
  }

  // ================================================================
  // Tab 1：API 设置（内容与 Step 5 原有字段完全一致）
  // ================================================================
  function buildApiTabHtml() {
    return (
      '<div class="settings-section" data-tab-panel="api">' +
      '  <div class="settings-section__title">API 设置</div>' +
      '  <p class="settings-section__hint">' +
      "    不绑定任何厂商，请自行填写兼容 OpenAI 请求格式的接口信息。" +
      "    API Key 仅保存在本机浏览器本地（经过简单编码存储），只会被发往你下面填写的接口地址，不会上传到其他任何地方。" +
      "  </p>" +
      '  <label class="settings-field">' +
      '    <span class="settings-field__label">Base URL</span>' +
      '    <input type="text" id="cfg-base-url" class="settings-field__input" placeholder="例如：https://your-api-host.example.com/v1（留空则无法发送消息）" autocomplete="off" />' +
      "  </label>" +
      '  <label class="settings-field">' +
      '    <span class="settings-field__label">API Key</span>' +
      '    <input type="password" id="cfg-api-key" class="settings-field__input" placeholder="留空表示该接口无需鉴权" autocomplete="off" />' +
      "  </label>" +
      '  <label class="settings-field">' +
      '    <span class="settings-field__label">模型名称（Model ID）</span>' +
      '    <input type="text" id="cfg-model" class="settings-field__input" placeholder="例如：your-model-id（必填）" autocomplete="off" />' +
      "  </label>" +
      '  <div class="settings-field-row">' +
      '    <label class="settings-field settings-field--half">' +
      '      <span class="settings-field__label">温度 Temperature</span>' +
      '      <input type="number" id="cfg-temperature" class="settings-field__input" min="0" max="2" step="0.1" />' +
      "    </label>" +
      '    <label class="settings-field settings-field--half">' +
      '      <span class="settings-field__label">最大生成长度 Max Tokens</span>' +
      '      <input type="number" id="cfg-max-tokens" class="settings-field__input" min="1" max="32000" step="1" />' +
      "    </label>" +
      "  </div>" +
      '  <div class="settings-switch-row">' +
      '    <label class="settings-switch">' +
      '      <input type="checkbox" id="cfg-stream" />' +
      '      <span>启用流式输出（SSE）</span>' +
      "    </label>" +
      '    <label class="settings-switch">' +
      '      <input type="checkbox" id="cfg-thinking" />' +
      '      <span>启用深度思考模式</span>' +
      "    </label>" +
      '    <label class="settings-switch">' +
      '      <input type="checkbox" id="cfg-file-upload" />' +
      '      <span>接口支持随消息发送文件/图片</span>' +
      "    </label>" +
      "  </div>" +
      '  <label class="settings-field">' +
      '    <span class="settings-field__label">请求超时时间（毫秒）</span>' +
      '    <input type="number" id="cfg-timeout" class="settings-field__input" min="1000" step="1000" />' +
      "  </label>" +
      "</div>"
    );
  }

  // ================================================================
  // Tab 2：外观（深浅色切换 + 配色包 + 自定义配色）
  // ================================================================
  function buildAppearanceTabHtml() {
    return (
      '<div class="settings-section" data-tab-panel="appearance" hidden>' +
      '  <div class="settings-section__title">深色 / 浅色</div>' +
      '  <div class="theme-mode-options" role="radiogroup" aria-label="深浅色模式">' +
      '    <button type="button" class="theme-mode-option" data-mode="light">浅色</button>' +
      '    <button type="button" class="theme-mode-option" data-mode="dark">深色</button>' +
      '    <button type="button" class="theme-mode-option" data-mode="system">跟随系统</button>' +
      "  </div>" +
      '  <div class="settings-section__title" style="margin-top: 18px;">配色方案</div>' +
      '  <p class="settings-section__hint">以下配色包随当前深浅色模式自动分组展示，点击即可一键应用整套主色、气泡与选中态颜色。</p>' +
      '  <div id="theme-pack-list" class="theme-pack-list"></div>' +
      '  <div class="settings-section__title" style="margin-top: 18px;">自定义配色</div>' +
      '  <p class="settings-section__hint">自由替换主色与关键强调色；填写后立即预览生效，点击“保存为自定义配色”才会持久化。</p>' +
      '  <div class="custom-color-row">' +
      '    <label class="custom-color-field">' +
      '      <span>主色</span>' +
      '      <input type="color" id="custom-color-primary" />' +
      "    </label>" +
      '    <label class="custom-color-field">' +
      '      <span>用户气泡色</span>' +
      '      <input type="color" id="custom-color-bubble-user" />' +
      "    </label>" +
      '    <label class="custom-color-field">' +
      '      <span>选中态背景</span>' +
      '      <input type="color" id="custom-color-bg-active" />' +
      "    </label>" +
      "  </div>" +
      '  <div class="custom-color-actions">' +
      '    <button type="button" id="btn-save-custom-color" class="confirm-dialog__btn confirm-dialog__btn--confirm">保存为自定义配色</button>' +
      '    <button type="button" id="btn-clear-custom-color" class="confirm-dialog__btn confirm-dialog__btn--cancel">恢复配色包预设</button>' +
      "  </div>" +
      '  <div class="settings-panel__footer" style="border-top: none; margin-top: 18px; padding-top: 0; justify-content: flex-start;">' +
      '    <button type="button" id="btn-reset-theme" class="confirm-dialog__btn confirm-dialog__btn--cancel">一键恢复默认主题</button>' +
      "  </div>" +
      "</div>"
    );
  }

  // ================================================================
  // Tab 3：背景（会话独立背景图 + 滤镜，依赖 js/core/conversation-backgrounds.js）
  // ================================================================
  function buildBackgroundTabHtml() {
    return (
      '<div class="settings-section" data-tab-panel="background" hidden>' +
      '  <p class="settings-section__hint">' +
      "    背景设置只作用于当前正在查看的这一个对话，切换到别的对话会显示那个对话各自保存的背景（或者没有背景）。" +
      "    上传的图片只保存在你本机的浏览器里（IndexedDB），不会上传到任何服务器。" +
      "  </p>" +
      '  <div class="settings-section__title">内置预设</div>' +
      '  <div id="bg-preset-list" class="bg-preset-list"></div>' +
      '  <div class="settings-section__title" style="margin-top: 16px;">上传本地图片</div>' +
      '  <div class="bg-upload-row">' +
      '    <button type="button" id="btn-bg-upload" class="confirm-dialog__btn confirm-dialog__btn--confirm">选择图片</button>' +
      '    <input type="file" id="bg-upload-input" accept="image/*" hidden />' +
      '    <span id="bg-upload-hint" class="settings-section__hint" style="margin: 0;">支持 JPG / PNG 等常见格式，自动压缩，不限制原图大小</span>' +
      "  </div>" +
      '  <div id="bg-preview-wrap" class="bg-preview-wrap" hidden>' +
      '    <div id="bg-preview" class="bg-preview"></div>' +
      "  </div>" +
      '  <div class="settings-section__title" style="margin-top: 16px;">铺满方式</div>' +
      '  <div id="bg-fit-options" class="bg-fit-options" role="radiogroup" aria-label="铺满方式">' +
      '    <button type="button" class="bg-fit-option" data-fit="cover">填充</button>' +
      '    <button type="button" class="bg-fit-option" data-fit="contain">居中</button>' +
      '    <button type="button" class="bg-fit-option" data-fit="repeat">平铺</button>' +
      '    <button type="button" class="bg-fit-option" data-fit="stretch">拉伸</button>' +
      "  </div>" +
      '  <div class="settings-section__title" style="margin-top: 16px;">滤镜调节</div>' +
      '  <label class="bg-filter-row">' +
      '    <span class="bg-filter-row__label">模糊</span>' +
      '    <input type="range" id="bg-filter-blur" min="0" max="20" step="1" />' +
      '    <span id="bg-filter-blur-value" class="bg-filter-row__value">0px</span>' +
      "  </label>" +
      '  <label class="bg-filter-row">' +
      '    <span class="bg-filter-row__label">亮度</span>' +
      '    <input type="range" id="bg-filter-brightness" min="50" max="150" step="5" />' +
      '    <span id="bg-filter-brightness-value" class="bg-filter-row__value">100%</span>' +
      "  </label>" +
      '  <label class="bg-filter-row">' +
      '    <span class="bg-filter-row__label">对比度</span>' +
      '    <input type="range" id="bg-filter-contrast" min="50" max="150" step="5" />' +
      '    <span id="bg-filter-contrast-value" class="bg-filter-row__value">100%</span>' +
      "  </label>" +
      '  <div class="settings-panel__footer" style="border-top: none; margin-top: 18px; padding-top: 0; justify-content: flex-start;">' +
      '    <button type="button" id="btn-bg-clear" class="confirm-dialog__btn confirm-dialog__btn--cancel">清除当前对话背景</button>' +
      "  </div>" +
      "</div>"
    );
  }

  // ================================================================
  // Tab 4：对话压缩（依赖 js/core/compression.js + compression-settings.js）
  // ================================================================
  function buildCompressionTabHtml() {
    return (
      '<div class="settings-section" data-tab-panel="compression" hidden>' +
      '  <p class="settings-section__hint">' +
      "    当前对话的压缩状态、进度与手动压缩按钮已经移到对话界面本身（输入框上方），" +
      "    这里只负责调节压缩相关的参数。" +
      "  </p>" +

      '  <div class="settings-section__title">自动压缩</div>' +
      '  <div class="settings-switch-row">' +
      '    <label class="settings-switch">' +
      '      <input type="checkbox" id="cfg-compress-enabled" />' +
      '      <span>正常聊天时自动压缩（上下文占用过高时在后台静默压缩，不打断发送）</span>' +
      "    </label>" +
      "  </div>" +

      '  <div class="settings-section__title" style="margin-top: 16px;">压缩参数</div>' +
      '  <p class="settings-section__hint">' +
      "    参数含义移植自 DeepSeek Harness 官方压缩实现：上下文窗口是当前对接模型的 token 容量估计值；" +
      "    触发比例是占用达到该比例时自动压缩；保留比例是压缩后仍保留原文的最近内容占比。" +
      "  </p>" +
      '  <label class="settings-field">' +
      '    <span class="settings-field__label">上下文窗口（token，按你对接的模型容量填写）</span>' +
      '    <input type="number" id="cfg-compress-context-window" class="settings-field__input" min="1000" step="1000" />' +
      "  </label>" +
      '  <div class="settings-field-row">' +
      '    <label class="settings-field settings-field--half">' +
      '      <span class="settings-field__label">触发比例（<span id="cfg-compress-threshold-value">0.80</span>）</span>' +
      '      <input type="range" id="cfg-compress-threshold" min="0.5" max="0.95" step="0.01" />' +
      "    </label>" +
      '    <label class="settings-field settings-field--half">' +
      '      <span class="settings-field__label">保留比例（<span id="cfg-compress-retain-value">0.16</span>）</span>' +
      '      <input type="range" id="cfg-compress-retain" min="0.05" max="0.4" step="0.01" />' +
      "    </label>" +
      "  </div>" +
      "</div>"
    );
  }



  /**
   * 把当前配置回填到「对话压缩」Tab 的表单控件上。
   */
  function fillCompressionFormFromConfig() {
    if (!window.DSCompressionSettings) {
      return;
    }
    var cfg = window.DSCompressionSettings.getConfig();
    setChecked("cfg-compress-enabled", cfg.enabled);
    setValue("cfg-compress-context-window", cfg.contextWindow);
    setValue("cfg-compress-threshold", cfg.thresholdRatio);
    setValue("cfg-compress-retain", cfg.retainRatio);
    var thresholdLabel = document.getElementById("cfg-compress-threshold-value");
    if (thresholdLabel) {
      thresholdLabel.textContent = cfg.thresholdRatio.toFixed(2);
    }
    var retainLabel = document.getElementById("cfg-compress-retain-value");
    if (retainLabel) {
      retainLabel.textContent = cfg.retainRatio.toFixed(2);
    }
  }

  /**
   * 把当前活跃对话的背景（含图片/预设/滤镜）渲染到背景 Tab 的各个控件上，
   * 并实时把计算出的样式应用到聊天区背景层——设置面板和聊天区背景永远保持同步。
   */
  function refreshBackgroundTab() {
    var presetList = document.getElementById("bg-preset-list");
    if (!presetList || !window.DSConvBackgrounds) {
      return;
    }
    var conv = window.DSSidebar ? window.DSSidebar.getActiveConversation() : null;
    var uploadBtn = document.getElementById("btn-bg-upload");
    var clearBtn = document.getElementById("btn-bg-clear");
    if (!conv) {
      presetList.innerHTML = '<p class="settings-section__hint">当前没有打开的对话，请先新建或选择一个对话后再设置背景。</p>';
      if (uploadBtn) {
        uploadBtn.disabled = true;
      }
      if (clearBtn) {
        clearBtn.disabled = true;
      }
      return;
    }
    if (uploadBtn) {
      uploadBtn.disabled = false;
    }
    if (clearBtn) {
      clearBtn.disabled = false;
    }

    // 预设色板：无论当前是否选中都先渲染出来，渲染完成后再根据背景数据回填选中态
    presetList.innerHTML = "";
    window.DSConvBackgrounds.PRESETS.forEach(function (preset) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bg-preset-swatch";
      btn.dataset.presetId = preset.id;
      btn.style.background = preset.preview;
      btn.title = preset.label;
      btn.setAttribute("aria-label", preset.label);
      btn.addEventListener("click", function () {
        window.DSConvBackgrounds.setPresetBackground(conv.id, preset.id).then(function () {
          applyBackgroundToChatArea(conv.id);
          refreshBackgroundTab();
          if (window.DSToast) {
            window.DSToast.success("已应用「" + preset.label + "」背景");
          }
        });
      });
      presetList.appendChild(btn);
    });

    window.DSConvBackgrounds.getBackground(conv.id).then(function (bg) {
      var settings = bg.settings;

      // 预设选中态高亮
      presetList.querySelectorAll(".bg-preset-swatch").forEach(function (btn) {
        btn.classList.toggle("is-active", settings.type === "preset" && settings.presetId === btn.dataset.presetId);
      });

      // 上传预览图：仅 type 为 upload 且有 blobUrl 时展示
      var previewWrap = document.getElementById("bg-preview-wrap");
      var preview = document.getElementById("bg-preview");
      if (settings.type === "upload" && bg.blobUrl) {
        previewWrap.hidden = false;
        preview.style.backgroundImage = 'url("' + bg.blobUrl + '")';
      } else {
        previewWrap.hidden = true;
        preview.style.backgroundImage = "";
      }

      // 铺满方式按钮高亮
      el.panel.querySelectorAll(".bg-fit-option").forEach(function (btn) {
        btn.classList.toggle("is-active", btn.dataset.fit === settings.fit);
      });

      // 滤镜滑块回填
      setRangeAndLabel("bg-filter-blur", "bg-filter-blur-value", settings.blur, "px");
      setRangeAndLabel("bg-filter-brightness", "bg-filter-brightness-value", settings.brightness, "%");
      setRangeAndLabel("bg-filter-contrast", "bg-filter-contrast-value", settings.contrast, "%");

      // 没有任何背景时，滤镜/铺满方式控件置灰，避免用户以为能调节一个根本不存在的背景
      var hasBackground = settings.type !== "none";
      el.panel.querySelectorAll(".bg-fit-option").forEach(function (btn) {
        btn.disabled = !hasBackground;
      });
      ["bg-filter-blur", "bg-filter-brightness", "bg-filter-contrast"].forEach(function (id) {
        var input = document.getElementById(id);
        if (input) {
          input.disabled = !hasBackground;
        }
      });
    });
  }

  function setRangeAndLabel(inputId, labelId, value, unit) {
    var input = document.getElementById(inputId);
    var label = document.getElementById(labelId);
    if (input) {
      input.value = value;
    }
    if (label) {
      label.textContent = value + unit;
    }
  }

  /**
   * 把指定会话当前保存的背景设置，实际应用到聊天区的 #chat-background 图层上。
   * 这是"设置面板调完之后，聊天区立刻看到效果"的关键一步，发生在：
   *   1. 设置面板里任何一次背景操作之后
   *   2. 切换会话之后（由 js/modules/chat/chat.js 在对话切换回调里调用）
   */
  function applyBackgroundToChatArea(conversationId) {
    var bgLayer = document.getElementById("chat-background");
    if (!bgLayer || !window.DSConvBackgrounds) {
      return;
    }
    window.DSConvBackgrounds.getBackground(conversationId).then(function (bg) {
      var style = window.DSConvBackgrounds.computeBackgroundStyle(bg.settings, bg.blobUrl);
      Object.keys(style).forEach(function (key) {
        bgLayer.style[key] = style[key];
      });
    });
  }

  /**
   * 渲染配色包色板列表：按当前深浅色模式对应分组，动态生成一排可点击的色块按钮。
   * 切换深浅色后需要重新调用本函数刷新成另一组配色包。
   */
  function renderThemePacks() {
    var container = document.getElementById("theme-pack-list");
    if (!container || !window.DSTheme) {
      return;
    }
    var themeState = window.DSTheme.getState();
    var packs = window.DSTheme.getPacksForScheme(themeState.effectiveScheme);

    container.innerHTML = "";
    packs.forEach(function (pack) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "theme-pack-swatch";
      btn.dataset.pack = pack.id;
      if (themeState.pack === pack.id || (!themeState.pack && pack.id === (themeState.effectiveScheme === "dark" ? "black" : "white"))) {
        btn.classList.add("is-active");
      }
      var dot = document.createElement("span");
      dot.className = "theme-pack-swatch__dot";
      dot.style.backgroundColor = pack.swatch;
      var label = document.createElement("span");
      label.className = "theme-pack-swatch__label";
      label.textContent = pack.label;
      btn.appendChild(dot);
      btn.appendChild(label);
      btn.addEventListener("click", function () {
        window.DSTheme.setPack(pack.id);
        renderThemePacks();
        if (window.DSToast) {
          window.DSToast.success("已切换到「" + pack.label + "」配色");
        }
      });
      container.appendChild(btn);
    });
  }

  /**
   * 高亮当前生效的深浅色模式按钮。
   */
  function syncThemeModeButtons() {
    if (!window.DSTheme) {
      return;
    }
    var mode = window.DSTheme.getState().mode;
    var buttons = el.panel.querySelectorAll(".theme-mode-option");
    buttons.forEach(function (btn) {
      btn.classList.toggle("is-active", btn.dataset.mode === mode);
    });
  }

  /**
   * 把当前自定义配色（若有）或配色包预设值填充到拾色器输入框，方便用户在已有基础上微调。
   */
  function syncCustomColorInputsFromState() {
    if (!window.DSTheme) {
      return;
    }
    var themeState = window.DSTheme.getState();
    var computed = getComputedStyle(document.documentElement);
    var primaryInput = document.getElementById("custom-color-primary");
    var bubbleInput = document.getElementById("custom-color-bubble-user");
    var activeInput = document.getElementById("custom-color-bg-active");
    if (primaryInput) {
      primaryInput.value = toHexColor(
        (themeState.custom && themeState.custom.primary) || computed.getPropertyValue("--color-primary")
      );
    }
    if (bubbleInput) {
      bubbleInput.value = toHexColor(
        (themeState.custom && themeState.custom.bubbleUser) || computed.getPropertyValue("--color-bubble-user")
      );
    }
    if (activeInput) {
      activeInput.value = toHexColor(
        (themeState.custom && themeState.custom.bgActive) || computed.getPropertyValue("--color-bg-active")
      );
    }
  }

  /**
   * <input type="color"> 只接受形如 #rrggbb 的十六进制值；CSS 变量里可能是其他合法颜色写法
   * （本项目目前全部是十六进制，这里做一层保护性转换，取不到时退化为黑色，避免浏览器报非法值警告）。
   */
  function toHexColor(value) {
    var trimmed = (value || "").trim();
    if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
      return trimmed;
    }
    return "#000000";
  }

  // ================================================================
  // Tab 切换
  // ================================================================
  function switchTab(tabName) {
    currentTab = tabName;
    var tabButtons = el.panel.querySelectorAll(".settings-tab");
    tabButtons.forEach(function (btn) {
      var active = btn.dataset.tab === tabName;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    var panels = el.panel.querySelectorAll("[data-tab-panel]");
    panels.forEach(function (panel) {
      panel.hidden = panel.dataset.tabPanel !== tabName;
    });
    if (tabName === "appearance") {
      renderThemePacks();
      syncThemeModeButtons();
      syncCustomColorInputsFromState();
    } else if (tabName === "background") {
      refreshBackgroundTab();
    } else if (tabName === "compression") {
      fillCompressionFormFromConfig();
    }
  }

  /**
   * 面板内部节点动态创建后，统一在此一次性绑定所有事件（首次 buildPanelContent 时调用一次）。
   */
  function bindPanelEvents() {
    document.getElementById("btn-close-settings").addEventListener("click", closeModal);
    document.getElementById("btn-settings-save").addEventListener("click", handleSave);
    document.getElementById("btn-settings-reset").addEventListener("click", handleReset);

    var tabButtons = el.panel.querySelectorAll(".settings-tab");
    tabButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        switchTab(btn.dataset.tab);
      });
    });

    var modeButtons = el.panel.querySelectorAll(".theme-mode-option");
    modeButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        window.DSTheme.setMode(btn.dataset.mode);
        syncThemeModeButtons();
        renderThemePacks();
        syncCustomColorInputsFromState();
      });
    });

    var btnSaveCustom = document.getElementById("btn-save-custom-color");
    if (btnSaveCustom) {
      btnSaveCustom.addEventListener("click", function () {
        var primary = document.getElementById("custom-color-primary").value;
        var bubbleUser = document.getElementById("custom-color-bubble-user").value;
        var bgActive = document.getElementById("custom-color-bg-active").value;
        window.DSTheme.setCustomColors({
          primary: primary,
          primaryHover: primary,
          primaryActive: primary,
          bubbleUser: bubbleUser,
          bgActive: bgActive
        });
        if (window.DSToast) {
          window.DSToast.success("自定义配色已保存");
        }
      });
    }

    var btnClearCustom = document.getElementById("btn-clear-custom-color");
    if (btnClearCustom) {
      btnClearCustom.addEventListener("click", function () {
        window.DSTheme.clearCustomColors();
        syncCustomColorInputsFromState();
        if (window.DSToast) {
          window.DSToast.success("已恢复配色包预设颜色");
        }
      });
    }

    var btnResetTheme = document.getElementById("btn-reset-theme");
    if (btnResetTheme) {
      btnResetTheme.addEventListener("click", function () {
        window.DSConfirm
          .show({
            title: "恢复默认主题",
            message: "将恢复为跟随系统深浅色 + 默认配色包，并清空自定义配色，确定要继续吗？",
            confirmText: "恢复默认",
            danger: false
          })
          .then(function (ok) {
            if (!ok) {
              return;
            }
            window.DSTheme.resetToDefault();
            syncThemeModeButtons();
            renderThemePacks();
            syncCustomColorInputsFromState();
            if (window.DSToast) {
              window.DSToast.success("已恢复默认主题");
            }
          });
      });
    }

    bindBackgroundTabEvents();
    bindCompressionTabEvents();
  }

  /**
   * 绑定「对话压缩」Tab 内所有控件事件：开关/阈值即时持久化，
   * "立即压缩当前对话"按钮复用与顶部压缩按钮一致的真实压缩流程，
   * 并把进度实时渲染到本 Tab 的进度卡片上（阶段文字 + 已用时长 +
   * 有流式时的实时字数，与顶部按钮同一套进度语义，只是展示位置不同）。
   */
  function bindCompressionTabEvents() {
    var enabledInput = document.getElementById("cfg-compress-enabled");
    if (enabledInput) {
      enabledInput.addEventListener("change", function () {
        window.DSCompressionSettings.updateConfig({ enabled: enabledInput.checked });
      });
    }

    var contextWindowInput = document.getElementById("cfg-compress-context-window");
    if (contextWindowInput) {
      contextWindowInput.addEventListener("change", function () {
        var value = parseInt(contextWindowInput.value, 10);
        if (isNaN(value) || value < 1000) {
          value = window.DSCompressionSettings.DEFAULTS.contextWindow;
          contextWindowInput.value = value;
        }
        window.DSCompressionSettings.updateConfig({ contextWindow: value });
      });
    }

    var thresholdInput = document.getElementById("cfg-compress-threshold");
    var thresholdLabel = document.getElementById("cfg-compress-threshold-value");
    if (thresholdInput) {
      thresholdInput.addEventListener("input", function () {
        if (thresholdLabel) {
          thresholdLabel.textContent = Number(thresholdInput.value).toFixed(2);
        }
      });
      thresholdInput.addEventListener("change", function () {
        window.DSCompressionSettings.updateConfig({ thresholdRatio: Number(thresholdInput.value) });
      });
    }

    var retainInput = document.getElementById("cfg-compress-retain");
    var retainLabel = document.getElementById("cfg-compress-retain-value");
    if (retainInput) {
      retainInput.addEventListener("input", function () {
        if (retainLabel) {
          retainLabel.textContent = Number(retainInput.value).toFixed(2);
        }
      });
      retainInput.addEventListener("change", function () {
        window.DSCompressionSettings.updateConfig({ retainRatio: Number(retainInput.value) });
      });
    }
    // "立即压缩当前对话"按钮与压缩进度展示已经移到对话界面本身
    // （index.html 的 #compress-status-bar，由 chat.js 的 bindCompressButton 驱动），
    // 设置面板这个 Tab 现在只负责参数调节，不再重复实现一套压缩触发逻辑。
  }

  /**
   * 绑定「背景」Tab 内所有控件的事件（上传按钮、文件选择、铺满方式、滤镜滑块、清除按钮）。
   * 预设色板的点击事件在 refreshBackgroundTab 里为每个动态生成的色块单独绑定，这里不重复处理。
   */
  function bindBackgroundTabEvents() {
    var uploadBtn = document.getElementById("btn-bg-upload");
    var uploadInput = document.getElementById("bg-upload-input");
    if (uploadBtn && uploadInput) {
      uploadBtn.addEventListener("click", function () {
        uploadInput.click();
      });
      uploadInput.addEventListener("change", function (e) {
        var file = e.target.files && e.target.files[0];
        uploadInput.value = "";
        if (!file) {
          return;
        }
        var conv = window.DSSidebar ? window.DSSidebar.getActiveConversation() : null;
        if (!conv) {
          if (window.DSToast) {
            window.DSToast.warning("请先选择一个对话再设置背景");
          }
          return;
        }
        if (!window.DSConvBackgrounds) {
          return;
        }
        var hideLoading = window.DSToast ? window.DSToast.loading("正在处理图片…") : null;
        window.DSConvBackgrounds.setUploadBackground(conv.id, file)
          .then(function () {
            if (hideLoading) {
              hideLoading();
            }
            applyBackgroundToChatArea(conv.id);
            refreshBackgroundTab();
            if (window.DSToast) {
              window.DSToast.success("背景已设置");
            }
          })
          .catch(function (err) {
            if (hideLoading) {
              hideLoading();
            }
            console.error("[DSSettings] 设置背景图失败：", err);
            if (window.DSToast) {
              window.DSToast.error("图片处理失败，请换一张图片重试");
            }
          });
      });
    }

    var fitButtons = el.panel.querySelectorAll(".bg-fit-option");
    fitButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var conv = window.DSSidebar ? window.DSSidebar.getActiveConversation() : null;
        if (!conv || !window.DSConvBackgrounds) {
          return;
        }
        window.DSConvBackgrounds.updateFilterSettings(conv.id, { fit: btn.dataset.fit }).then(function () {
          applyBackgroundToChatArea(conv.id);
          refreshBackgroundTab();
        });
      });
    });

    var filterInputs = [
      { id: "bg-filter-blur", labelId: "bg-filter-blur-value", unit: "px", key: "blur" },
      { id: "bg-filter-brightness", labelId: "bg-filter-brightness-value", unit: "%", key: "brightness" },
      { id: "bg-filter-contrast", labelId: "bg-filter-contrast-value", unit: "%", key: "contrast" }
    ];
    filterInputs.forEach(function (item) {
      var input = document.getElementById(item.id);
      var label = document.getElementById(item.labelId);
      if (!input) {
        return;
      }
      input.addEventListener("input", function () {
        // 拖动过程中只更新数值标签 + 实时预览聊天区背景，不写入 IndexedDB，避免拖动期间频繁写库
        if (label) {
          label.textContent = input.value + item.unit;
        }
        var conv = window.DSSidebar ? window.DSSidebar.getActiveConversation() : null;
        if (!conv || !window.DSConvBackgrounds) {
          return;
        }
        window.DSConvBackgrounds.getBackground(conv.id).then(function (bg) {
          var previewSettings = Object.assign({}, bg.settings);
          previewSettings[item.key] = Number(input.value);
          var style = window.DSConvBackgrounds.computeBackgroundStyle(previewSettings, bg.blobUrl);
          var bgLayer = document.getElementById("chat-background");
          if (bgLayer) {
            Object.keys(style).forEach(function (key) {
              bgLayer.style[key] = style[key];
            });
          }
        });
      });
      input.addEventListener("change", function () {
        // 松手（change 事件）时才真正持久化这次调整后的值
        var conv = window.DSSidebar ? window.DSSidebar.getActiveConversation() : null;
        if (!conv || !window.DSConvBackgrounds) {
          return;
        }
        var partial = {};
        partial[item.key] = Number(input.value);
        window.DSConvBackgrounds.updateFilterSettings(conv.id, partial);
      });
    });

    var clearBtn = document.getElementById("btn-bg-clear");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        var conv = window.DSSidebar ? window.DSSidebar.getActiveConversation() : null;
        if (!conv || !window.DSConvBackgrounds) {
          return;
        }
        window.DSConfirm
          .show({
            title: "清除当前对话背景",
            message: "将清除这个对话的背景图与滤镜设置，确定要继续吗？",
            confirmText: "清除",
            danger: true
          })
          .then(function (ok) {
            if (!ok) {
              return;
            }
            window.DSConvBackgrounds.clearBackground(conv.id).then(function () {
              applyBackgroundToChatArea(conv.id);
              refreshBackgroundTab();
              if (window.DSToast) {
                window.DSToast.success("已清除背景");
              }
            });
          });
      });
    }
  }

  /**
   * 把当前生效的配置（默认值与用户已保存值合并后的结果）填充到表单各输入框中。
   */
  function fillFormFromConfig() {
    var cfg = window.DSUserConfig ? window.DSUserConfig.getApiConfig() : {};
    setValue("cfg-base-url", cfg.baseUrl);
    setValue("cfg-api-key", cfg.apiKey);
    setValue("cfg-model", cfg.model);
    setValue("cfg-temperature", typeof cfg.temperature === "number" ? cfg.temperature : 1.0);
    setValue("cfg-max-tokens", typeof cfg.maxTokens === "number" ? cfg.maxTokens : 2048);
    setValue("cfg-timeout", typeof cfg.timeoutMs === "number" ? cfg.timeoutMs : 60000);
    setChecked("cfg-stream", cfg.stream !== false);
    setChecked("cfg-thinking", !!cfg.enableThinking);
    setChecked("cfg-file-upload", !!cfg.supportsFileUpload);
  }

  function setValue(id, value) {
    var elNode = document.getElementById(id);
    if (elNode) {
      elNode.value = value == null ? "" : value;
    }
  }

  function setChecked(id, checked) {
    var elNode = document.getElementById(id);
    if (elNode) {
      elNode.checked = !!checked;
    }
  }

  function getValue(id) {
    var elNode = document.getElementById(id);
    return elNode ? elNode.value : "";
  }

  function getChecked(id) {
    var elNode = document.getElementById(id);
    return elNode ? elNode.checked : false;
  }

  /**
   * 校验并保存表单内容到本地配置。
   */
  function handleSave() {
    var baseUrl = getValue("cfg-base-url").trim();
    var model = getValue("cfg-model").trim();

    // 边界处理：温度/最大长度/超时时间需要是合法数字，非法输入时回退为默认值并提示，而不是静默保存一个 NaN
    var temperature = parseFloat(getValue("cfg-temperature"));
    if (isNaN(temperature)) {
      temperature = 1.0;
    }
    temperature = Math.min(2, Math.max(0, temperature));

    var maxTokens = parseInt(getValue("cfg-max-tokens"), 10);
    if (isNaN(maxTokens) || maxTokens <= 0) {
      maxTokens = 2048;
    }

    var timeoutMs = parseInt(getValue("cfg-timeout"), 10);
    if (isNaN(timeoutMs) || timeoutMs < 1000) {
      timeoutMs = 60000;
    }

    var partial = {
      baseUrl: baseUrl,
      apiKey: getValue("cfg-api-key").trim(),
      model: model,
      temperature: temperature,
      maxTokens: maxTokens,
      timeoutMs: timeoutMs,
      stream: getChecked("cfg-stream"),
      enableThinking: getChecked("cfg-thinking"),
      supportsFileUpload: getChecked("cfg-file-upload")
    };

    if (window.DSUserConfig) {
      window.DSUserConfig.updateApiConfig(partial);
    }

    if (!baseUrl || !model) {
      if (window.DSToast) {
        window.DSToast.warning("已保存，但 Base URL 与模型名称均为必填项，发送消息前请补充完整");
      }
    } else if (window.DSToast) {
      window.DSToast.success("设置已保存");
    }

    closeModal();
  }

  /**
   * 恢复默认配置（清空用户自定义值），并刷新表单显示。
   * 仅影响 API 设置分区；外观分区有独立的「一键恢复默认主题」按钮，职责分开。
   */
  function handleReset() {
    window.DSConfirm
      .show({
        title: "恢复默认设置",
        message: "将清空当前已保存的 API 配置（Base URL / Key / 模型名等），确定要恢复默认吗？",
        confirmText: "恢复默认",
        danger: true
      })
      .then(function (ok) {
        if (!ok) {
          return;
        }
        if (window.DSUserConfig) {
          window.DSUserConfig.resetApiConfig();
        }
        fillFormFromConfig();
        if (window.DSToast) {
          window.DSToast.success("已恢复默认设置");
        }
      });
  }

  // ================================================================
  // 弹窗开关
  // ================================================================
  function openModal() {
    buildPanelContent();
    fillFormFromConfig();
    switchTab(currentTab);
    el.modal.hidden = false;
    requestAnimationFrame(function () {
      el.modal.classList.add("is-open");
    });
  }

  function closeModal() {
    el.modal.classList.remove("is-open");
    setTimeout(function () {
      el.modal.hidden = true;
    }, 220);
  }

  function handleGlobalKeydown(e) {
    if (e.key === "Escape" && el.modal && !el.modal.hidden) {
      closeModal();
    }
  }

  // ================================================================
  // 初始化
  // ================================================================
  function init() {
    cacheDom();
    if (!el.modal || !el.panel) {
      console.warn("[DSSettings] 未找到设置弹窗容器节点，设置功能未初始化。");
      return;
    }
    if (el.btnOpen) {
      el.btnOpen.addEventListener("click", openModal);
    }
    if (el.mask) {
      el.mask.addEventListener("click", closeModal);
    }
    document.addEventListener("keydown", handleGlobalKeydown);

    // 应用启动时，把当前已选中会话的背景（若有）立即应用到聊天区，不需要等用户打开设置面板
    var initialConv = window.DSSidebar ? window.DSSidebar.getActiveConversation() : null;
    if (initialConv) {
      applyBackgroundToChatArea(initialConv.id);
    }

    console.log("[DSSettings] 初始化完成（API 设置 / 外观 / 背景三个分区）。");
  }

  window.DSSettings = {
    init: init,
    open: openModal,
    close: closeModal,
    // 供 js/modules/chat/chat.js 在切换对话时调用，让聊天区背景跟随当前会话实时切换
    applyBackgroundToChatArea: applyBackgroundToChatArea
  };
})();
