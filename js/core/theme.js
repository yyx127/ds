/**
 * ============================================================
 * theme.js —— 主题引擎（深浅色切换 + 配色包 + 自定义配色）
 * ============================================================
 * 职责：
 *   1. 深色 / 浅色 / 跟随系统：写入 html[data-theme]，并在"跟随系统"时
 *      监听 prefers-color-scheme 变化实时联动
 *   2. 配色包切换：写入 html[data-theme-pack]，具体色值由 css/theme-packs.css
 *      按 [data-theme][data-theme-pack] 组合选择器提供
 *   3. 自定义配色：用户用拾色器选定的任意色值，直接以行内 style 写到
 *      document.documentElement 上，优先级天然高于任何 class/属性选择器，
 *      不需要单独的 CSS 规则；提供「保存为我的配色」「恢复预设」两个入口
 *   4. 全部状态持久化到 localStorage，页面刷新后自动恢复
 *
 * 不依赖任何 UI 框架，纯状态管理 + DOM 属性操作；具体“设置面板里的配色选择 UI”
 * 由 settings.js 的外观分区调用本模块提供的方法。
 * ============================================================
 */

(function () {
  "use strict";

  var STORAGE_KEY_MODE = "ds_chat_clone__theme_mode"; // 'light' | 'dark' | 'system'
  var STORAGE_KEY_PACK = "ds_chat_clone__theme_pack"; // 配色包 id
  var STORAGE_KEY_CUSTOM = "ds_chat_clone__theme_custom"; // 自定义色值 JSON

  // 深浅两组配色包定义：id 为写入 data-theme-pack 的值，label 为设置面板里展示的中文名，
  // swatch 用于设置面板色板预览（取该配色包的主色，不是真实渲染出的完整配色，只做直观参考）。
  var PACKS = {
    dark: [
      { id: "black", label: "黑色", swatch: "#4d6bfe" },
      { id: "navy-blue", label: "深蓝", swatch: "#3b82f6" },
      { id: "dark-green", label: "墨绿", swatch: "#35b579" },
      { id: "dark-purple", label: "深紫", swatch: "#9168f0" }
    ],
    light: [
      { id: "white", label: "白色", swatch: "#4d6bfe" },
      { id: "light-blue", label: "浅蓝", swatch: "#2f8fe0" },
      { id: "mint-green", label: "薄荷绿", swatch: "#2bab7e" },
      { id: "light-pink", label: "浅粉", swatch: "#e2669b" }
    ]
  };

  // 自定义配色允许覆盖的变量清单：只开放"最能代表整体色彩氛围"的几个变量，
  // 不开放背景分层/文字层级等结构性变量，避免用户调出不可用的低对比度组合。
  var CUSTOM_OVERRIDABLE_VARS = [
    "--color-primary",
    "--color-primary-hover",
    "--color-primary-active",
    "--color-primary-soft",
    "--color-bubble-user",
    "--color-bg-active"
  ];

  function readLocalStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function writeLocalStorage(key, value) {
    try {
      if (value === null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, value);
      }
    } catch (err) {
      // 边界处理：隐私模式/容量超限时只在内存生效，不阻断主题切换本身
      console.warn("[DSTheme] 本地存储写入失败，主题偏好仅本次会话内生效：", err);
    }
  }

  var systemMediaQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  /**
   * 解析当前实际应该生效的深浅色（system 模式下按系统偏好换算成具体的 light/dark）。
   * @param {string} mode 'light' | 'dark' | 'system'
   */
  function resolveEffectiveScheme(mode) {
    if (mode === "light" || mode === "dark") {
      return mode;
    }
    return systemMediaQuery && systemMediaQuery.matches ? "dark" : "light";
  }

  /**
   * 获取指定深浅色下默认的配色包 id（分别是 black / white），
   * 用于用户还没选过配色包、或者切换深浅色后原配色包在新的深浅色分组里不存在时的兜底。
   */
  function getDefaultPackId(scheme) {
    return scheme === "dark" ? "black" : "white";
  }

  var state = {
    mode: readLocalStorage(STORAGE_KEY_MODE) || "system",
    pack: readLocalStorage(STORAGE_KEY_PACK) || null,
    custom: null
  };

  (function loadCustom() {
    var raw = readLocalStorage(STORAGE_KEY_CUSTOM);
    if (!raw) {
      return;
    }
    try {
      state.custom = JSON.parse(raw);
    } catch (err) {
      console.warn("[DSTheme] 自定义配色数据损坏，已忽略：", err);
      state.custom = null;
    }
  })();

  /**
   * 把当前 state 完整应用到 DOM：写 data-theme、data-theme-pack，
   * 并把自定义配色（若有）以行内样式覆盖到最上层。
   */
  function applyToDom() {
    var scheme = resolveEffectiveScheme(state.mode);
    var root = document.documentElement;

    root.setAttribute("data-theme", state.mode === "system" ? "system" : scheme);
    // data-theme 在 system 模式下写 "system"，配合 theme.css 的媒体查询兜底规则；
    // 但配色包选择器要求具体的 light/dark，这里额外在 root 上再写一次「真正生效」的 scheme，
    // 通过单独的 data-theme-scheme 属性供 theme-packs.css 的选择器判断，
    // 避免 system 模式下配色包规则因为 data-theme="system" 匹配不到而失效。
    root.setAttribute("data-theme-scheme", scheme);

    var packId = state.pack || getDefaultPackId(scheme);
    // 边界处理：若之前选的配色包不属于当前生效的深浅色分组（例如深色模式下残留了一个浅色包 id），
    // 回退到该深浅色分组的默认包，避免 [data-theme-pack] 选择器完全匹配不上导致主色变量丢失。
    var packExists = PACKS[scheme].some(function (p) {
      return p.id === packId;
    });
    if (!packExists) {
      packId = getDefaultPackId(scheme);
    }
    root.setAttribute("data-theme-pack", packId);

    applyCustomOverrides();
  }

  /**
   * 把自定义配色（若存在）以行内 CSS 变量写到 html 上；没有自定义配色时清空，
   * 让配色包的预设值重新生效。
   */
  function applyCustomOverrides() {
    var root = document.documentElement;
    CUSTOM_OVERRIDABLE_VARS.forEach(function (varName) {
      root.style.removeProperty(varName);
    });
    if (!state.custom) {
      return;
    }
    CUSTOM_OVERRIDABLE_VARS.forEach(function (varName) {
      var key = varName.replace(/^--color-/, "").replace(/-([a-z])/g, function (_, c) {
        return c.toUpperCase();
      });
      // key 形如 primary / primaryHover / primaryActive / primarySoft / bubbleUser / bgActive
      if (state.custom[key]) {
        root.style.setProperty(varName, state.custom[key]);
      }
    });
  }

  /**
   * 切换深浅色模式：'light' | 'dark' | 'system'。
   */
  function setMode(mode) {
    if (mode !== "light" && mode !== "dark" && mode !== "system") {
      return;
    }
    state.mode = mode;
    writeLocalStorage(STORAGE_KEY_MODE, mode);
    applyToDom();
  }

  /**
   * 切换配色包（按当前深浅色分组内的 id 选择）。
   */
  function setPack(packId) {
    state.pack = packId;
    writeLocalStorage(STORAGE_KEY_PACK, packId);
    applyToDom();
  }

  /**
   * 保存自定义配色。传入的对象键名与 CUSTOM_OVERRIDABLE_VARS 的驼峰映射一致，
   * 例如 { primary: '#ff0000', primaryHover: '#cc0000' }，缺省的字段保留上一次已保存的值。
   */
  function setCustomColors(partial) {
    state.custom = Object.assign({}, state.custom || {}, partial || {});
    writeLocalStorage(STORAGE_KEY_CUSTOM, JSON.stringify(state.custom));
    applyToDom();
  }

  /**
   * 清空自定义配色，回退到当前选中配色包的预设值。
   */
  function clearCustomColors() {
    state.custom = null;
    writeLocalStorage(STORAGE_KEY_CUSTOM, null);
    applyToDom();
  }

  /**
   * 一键恢复默认主题：跟随系统 + 该深浅色分组默认配色包 + 清空自定义配色。
   */
  function resetToDefault() {
    state.mode = "system";
    state.pack = null;
    state.custom = null;
    writeLocalStorage(STORAGE_KEY_MODE, "system");
    writeLocalStorage(STORAGE_KEY_PACK, null);
    writeLocalStorage(STORAGE_KEY_CUSTOM, null);
    applyToDom();
  }

  function getState() {
    return {
      mode: state.mode,
      pack: state.pack,
      effectiveScheme: resolveEffectiveScheme(state.mode),
      custom: state.custom ? Object.assign({}, state.custom) : null
    };
  }

  function getPacksForScheme(scheme) {
    return PACKS[scheme] || PACKS.light;
  }

  function init() {
    applyToDom();
    // 跟随系统模式下，系统主题变化时实时联动（无需用户手动切换）
    if (systemMediaQuery) {
      var onSystemChange = function () {
        if (state.mode === "system") {
          applyToDom();
        }
      };
      if (systemMediaQuery.addEventListener) {
        systemMediaQuery.addEventListener("change", onSystemChange);
      } else if (systemMediaQuery.addListener) {
        // 兼容旧版 Safari（addEventListener 在 MediaQueryList 上不可用的版本）
        systemMediaQuery.addListener(onSystemChange);
      }
    }
    console.log("[DSTheme] 主题引擎初始化完成，当前模式：" + state.mode);
  }

  window.DSTheme = {
    init: init,
    setMode: setMode,
    setPack: setPack,
    setCustomColors: setCustomColors,
    clearCustomColors: clearCustomColors,
    resetToDefault: resetToDefault,
    getState: getState,
    getPacksForScheme: getPacksForScheme,
    CUSTOM_OVERRIDABLE_VARS: CUSTOM_OVERRIDABLE_VARS
  };
})();
