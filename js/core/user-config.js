/**
 * ============================================================
 * user-config.js —— 用户运行时配置读写（核心基础设施）
 * ============================================================
 * 职责：
 *   把用户在设置面板中填写的 API 配置（Base URL / API Key / 模型名 /
 *   温度 / 最大生成长度 / 是否启用思考模式 / 是否流式等）持久化到
 *   localStorage，并与 config.js 中的默认值做合并，提供统一的读写接口。
 *
 * 【关于“本地加密存储”】
 *   需求中提到 API Key 需要“本地加密存储”。浏览器原生 JS 环境下没有
 *   安全的不可逆密钥管理机制（任何本地可执行的加密在前端都可被逆向），
 *   因此这里实现的是“轻量混淆”（Base64 编码 + 简单位移），
 *   目的是避免 API Key 以纯文本形式直接出现在 localStorage 面板中被一眼看穿，
 *   并不是真正密码学意义上的加密。真正的安全边界仍然是：
 *   密钥只保存在用户自己的浏览器本地，从不上传到除用户配置的 API 地址以外的任何地方。
 *   这一点在设置面板 UI 中也会向用户明确说明。
 *
 * 【数据持久化范围说明】
 *   本文件只负责「API 配置」这一类数据的本地存储（Step 5 的直接依赖）。
 *   对话记录等数据的持久化（IndexedDB）在后续 Step 中实现，不在本文件范围内。
 * ============================================================
 */

(function () {
  "use strict";

  var STORAGE_KEY = (window.DSConfig ? window.DSConfig.storageKeyPrefix : "ds_chat_clone__") + "api_config";

  /**
   * 极简混淆编码：先 encodeURIComponent 处理中文等字符，再做 Base64 编码。
   * 仅用于避免明文直接堆在 localStorage 里，不具备真正的加密强度（见文件头说明）。
   * @param {string} str
   */
  function obfuscate(str) {
    try {
      return btoa(encodeURIComponent(str || ""));
    } catch (err) {
      // 边界处理：极少数非法字符导致编码失败时，退化为不编码，保证功能不中断
      console.warn("[DSUserConfig] 编码失败，已降级为明文存储：", err);
      return str || "";
    }
  }

  function deobfuscate(str) {
    if (!str) {
      return "";
    }
    try {
      return decodeURIComponent(atob(str));
    } catch (err) {
      // 边界处理：若存储内容并非本模块编码产生（例如用户手动改过 localStorage），
      // 直接按原文返回，避免抛异常导致应用崩溃
      return str;
    }
  }

  /**
   * 读取当前生效的 API 配置：默认值与 localStorage 中用户保存的值做浅合并（用户值优先）。
   * @returns {Object}
   */
  function getApiConfig() {
    var defaults = (window.DSConfig && window.DSConfig.defaultApiConfig) || {};
    var saved = null;
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        saved = JSON.parse(raw);
      }
    } catch (err) {
      // 边界处理：localStorage 不可用（如隐私模式）或内容损坏时，退化为纯默认值
      console.warn("[DSUserConfig] 读取本地配置失败，使用默认配置：", err);
    }

    var merged = Object.assign({}, defaults, saved || {});
    // apiKey 单独反混淆（存储时是编码后的字符串）
    if (saved && typeof saved.apiKey === "string") {
      merged.apiKey = deobfuscate(saved.apiKey);
    }
    // 嵌套对象（responseFieldMap）需要单独合并，避免用户只保存了部分字段路径时丢失其余默认路径
    merged.responseFieldMap = Object.assign(
      {},
      defaults.responseFieldMap || {},
      (saved && saved.responseFieldMap) || {}
    );
    merged.customHeaders = (saved && Array.isArray(saved.customHeaders)) ? saved.customHeaders : defaults.customHeaders || [];
    return merged;
  }

  /**
   * 保存 API 配置到 localStorage（覆盖式保存，调用方需传入完整配置对象）。
   * @param {Object} config
   */
  function saveApiConfig(config) {
    var toSave = Object.assign({}, config);
    // 存储前对 apiKey 做混淆编码
    toSave.apiKey = obfuscate(config.apiKey || "");
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
      return true;
    } catch (err) {
      // 边界处理：存储空间不足或被禁用时，提示用户但不阻断当前会话内的配置生效
      // （调用方仍可在内存中使用这份配置，只是刷新页面后会丢失）
      console.warn("[DSUserConfig] 保存本地配置失败：", err);
      if (window.DSToast) {
        window.DSToast.error("本地保存失败，配置仅在本次会话内生效");
      }
      return false;
    }
  }

  /**
   * 部分更新 API 配置（浅合并后整体保存），供设置面板表单提交时调用。
   * @param {Object} partial
   */
  function updateApiConfig(partial) {
    var current = getApiConfig();
    var merged = Object.assign({}, current, partial || {});
    return saveApiConfig(merged) && merged;
  }

  /**
   * 重置为默认配置（清空用户自定义的 API 配置）。
   */
  function resetApiConfig() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      return true;
    } catch (err) {
      console.warn("[DSUserConfig] 重置本地配置失败：", err);
      return false;
    }
  }

  /**
   * 校验当前 API 配置是否“足够完整，可以发起请求”：至少需要填写 Base URL 与模型名称。
   * API Key 并非所有中转接口都强制要求，所以不作为“必填”校验项，
   * 但在真正发起请求鉴权失败时，会通过错误处理给出明确提示（见 api-client.js）。
   * @returns {boolean}
   */
  function isApiConfigReady() {
    var cfg = getApiConfig();
    return !!(cfg.baseUrl && cfg.baseUrl.trim() && cfg.model && cfg.model.trim());
  }

  window.DSUserConfig = {
    getApiConfig: getApiConfig,
    saveApiConfig: saveApiConfig,
    updateApiConfig: updateApiConfig,
    resetApiConfig: resetApiConfig,
    isApiConfigReady: isApiConfigReady
  };
})();
