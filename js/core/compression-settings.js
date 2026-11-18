/**
 * ============================================================
 * compression-settings.js —— 压缩引擎的本地配置读写
 * ============================================================
 * 职责：持久化压缩相关的可调参数到 localStorage，供设置面板与
 * js/core/compression.js 的自动压缩钩子读取。字段含义对应
 * compression.js 移植自官方实现的同名概念：
 *   - enabled：是否启用自动压缩（正常聊天时自动监测并压缩）
 *   - contextWindow：当前对接模型的上下文窗口估计值（token），
 *     用于把 thresholdRatio / retainRatio 换算成具体 token 数
 *   - thresholdRatio：触发压缩的上下文占用比例（默认 0.8）
 *   - retainRatio：压缩后仍保留原文的尾部比例（默认 0.16）
 * ============================================================
 */

(function () {
  "use strict";

  var STORAGE_KEY = (window.DSConfig ? window.DSConfig.storageKeyPrefix : "ds_chat_clone__") + "compression_config";

  var DEFAULTS = {
    enabled: true,
    contextWindow: 32000,
    thresholdRatio: 0.8,
    retainRatio: 0.16
  };

  function getConfig() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var saved = raw ? JSON.parse(raw) : null;
      return Object.assign({}, DEFAULTS, saved || {});
    } catch (err) {
      console.warn("[DSCompressionSettings] 读取本地压缩配置失败，使用默认值：", err);
      return Object.assign({}, DEFAULTS);
    }
  }

  function updateConfig(partial) {
    var current = getConfig();
    var merged = Object.assign({}, current, partial || {});
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch (err) {
      console.warn("[DSCompressionSettings] 保存本地压缩配置失败：", err);
    }
    return merged;
  }

  window.DSCompressionSettings = {
    getConfig: getConfig,
    updateConfig: updateConfig,
    DEFAULTS: DEFAULTS
  };
})();
