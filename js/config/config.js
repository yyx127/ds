/**
 * ============================================================
 * config.js —— 全局默认配置常量集中声明
 * ============================================================
 * 本文件是整个应用「默认值」的唯一来源。
 * 原生 JS 无模块打包，这里采用在 window 下挂载命名空间对象的方式，
 * 供后续所有脚本（API 适配层、压缩模块、设置面板等）直接引用：
 *   window.DSConfig
 *
 * 【重要】用户自定义的实际配置（API 地址/密钥/模型名等）不会写在这里，
 * 而是运行时由用户在「设置面板」中填写后，持久化存储到 localStorage /
 * IndexedDB 中，再与本文件的默认值做合并（用户值优先）。
 * 本文件的职责仅仅是：提供一套「开箱即用、不绑定任何厂商」的默认骨架。
 *
 * 禁止事项提醒（遵照需求文档第六节）：
 * - 禁止在此处写死任何厂商的官方 API 地址
 * - 禁止在此处写死任何具体模型名称
 * 因此下方 API 相关默认值均为空字符串，必须由用户在设置面板中自行填写。
 * ============================================================
 */

// 使用立即执行函数包裹，避免内部临时变量污染全局作用域，
// 最终只向 window 挂载一个命名空间对象 DSConfig。
(function () {
  "use strict";

  /**
   * ---------------- 1. API 相关默认配置 ----------------
   * 对应需求文档「四、通用 API 适配层」中的全部可配置项。
   * 这些默认值仅在用户从未配置过时作为初始占位，
   * 实际生效值永远读取用户在设置面板中保存的内容。
   */
  var DEFAULT_API_CONFIG = {
    // API Base URL：用户填写接口地址，默认留空，不绑定任何厂商
    baseUrl: "",
    // API Key：用户填写密钥，默认留空；本地存储时会做简单加密处理（见 utils/crypto.js，后续 Step 实现）
    apiKey: "",
    // 模型名称（Model ID）：用户填写，默认留空
    model: "",
    // 采样温度：数值越大越随机，默认取通用中间值 1.0（OpenAI 格式默认范围 0~2）
    temperature: 1.0,
    // 单次回复最大生成长度（max_tokens）
    maxTokens: 2048,
    // 是否启用思考模式（对应请求体中可能需要传递的思考相关参数，具体字段由响应映射配置决定）
    enableThinking: false,
    // 是否使用流式输出（SSE）
    stream: true,
    // 当前适配的接口是否支持随消息发送文件/图片（多模态）。
    // 默认 false：通用 OpenAI 兼容适配层目前只拼纯文本 messages，不组装多模态 content 数组。
    // 【扩展预留位】后续若要对接支持图片输入的模型，在这里把默认值改为可配置项，
    // 并在 js/api/api-client.js 的请求体组装处，根据此开关决定是否把 attachments 转成
    // image_url / base64 等对应格式塞进 content 数组。
    supportsFileUpload: false,
    // 请求超时时间（毫秒），默认 60 秒
    timeoutMs: 60000,
    // 网络异常自动重试次数，默认 1 次
    retryTimes: 1,
    // 自定义请求头列表：数组，每项为 { key: string, value: string }
    // 用于中转接口的额外鉴权头等场景，默认空数组
    customHeaders: [],
    // 响应字段映射（JSON 路径语法，使用点号分隔，如 "choices.0.message.content"）
    // 默认采用 OpenAI 标准格式字段路径，用户可在设置面板中按需修改以适配非标准中转接口
    responseFieldMap: {
      // 非流式响应中，正文内容字段路径
      contentPath: "choices.0.message.content",
      // 非流式响应中，思考过程字段路径（部分深度思考模型会返回该字段，路径留给用户自定义）
      thinkingPath: "choices.0.message.reasoning_content",
      // 错误信息字段路径（用于非 2xx 响应体中提取人类可读错误描述）
      errorPath: "error.message",
      // 流式响应（SSE 的 data: 后面的 JSON）中，增量内容字段路径
      streamContentPath: "choices.0.delta.content",
      // 流式响应中，增量思考内容字段路径
      streamThinkingPath: "choices.0.delta.reasoning_content"
    }
  };

  /**
   * ---------------- 2. 主题 / 外观相关默认配置 ----------------
   */
  var DEFAULT_APPEARANCE_CONFIG = {
    // 主题模式：'light' | 'dark' | 'system'（跟随系统）
    themeMode: "system",
    // 主色调微调：允许用户在设置面板中微调主色（HEX），默认使用 DeepSeek 风格蓝紫色
    primaryColor: "#4d6bfe"
  };

  /**
   * ---------------- 3. 对话行为相关默认配置 ----------------
   */
  var DEFAULT_CHAT_CONFIG = {
    // 是否开启流式输出（与 API 配置中的 stream 字段保持一致语义，这里作为“对话设置”分组的镜像展示项）
    streamEnabled: true,
    // 是否自动根据首条消息生成对话标题
    autoTitle: true,
    // 发送消息前是否需要二次确认
    confirmBeforeSend: false
  };

  /**
   * ---------------- 4. 智能对话压缩机制默认配置 ----------------
   * 对应需求文档「三、核心功能：智能对话压缩省 Token 机制」。
   */
  var DEFAULT_COMPRESSION_CONFIG = {
    // 是否开启自动压缩
    autoCompressEnabled: true,
    // 自动压缩触发的对话轮数阈值（一问一答算一轮），默认 10 轮，范围 5-30
    triggerRounds: 10,
    // 预估上下文 Token 超过该阈值时自动触发压缩，默认 4000
    tokenThreshold: 4000,
    // 压缩强度：'light'（轻度） | 'medium'（中度，默认） | 'heavy'（重度）
    compressionLevel: "medium",
    // 压缩时始终保留的最新对话轮数（这些轮次永远保留原文，不参与压缩）
    keepRecentRounds: 3
  };

  /**
   * ---------------- 5. Token 估算相关默认配置 ----------------
   * 本地简易估算算法所需的系数，无需绝对精确，仅用于让用户感知成本量级。
   */
  var DEFAULT_TOKEN_ESTIMATE_CONFIG = {
    // 中文字符按多少字符折算 1 个 token（经验系数，中文通常比英文更「贵」）
    cnCharsPerToken: 1.5,
    // 英文按多少个字符折算 1 个 token（英文单词平均长度 + 空格的经验系数）
    enCharsPerToken: 4
  };

  /**
   * ---------------- 6. 全局命名空间组装 ----------------
   * 挂载到 window.DSConfig，供全站脚本引用。
   * 注意：这里导出的是「默认值」，真正的运行时配置对象由后续 Step 的
   * js/core/storage.js（本地持久化读写）与设置模块合并用户数据后生成，
   * 并统一通过 core 层的状态管理对象提供给各功能模块使用。
   */
  window.DSConfig = {
    // 应用名称与版本号，用于导出数据文件命名、关于页展示等
    appName: "DeepSeek 风格聊天客户端",
    appVersion: "0.1.0",

    // 各分组默认配置
    defaultApiConfig: DEFAULT_API_CONFIG,
    defaultAppearanceConfig: DEFAULT_APPEARANCE_CONFIG,
    defaultChatConfig: DEFAULT_CHAT_CONFIG,
    defaultCompressionConfig: DEFAULT_COMPRESSION_CONFIG,
    defaultTokenEstimateConfig: DEFAULT_TOKEN_ESTIMATE_CONFIG,

    // 本地存储使用的键名统一前缀，避免与其他网页应用的 localStorage/IndexedDB 冲突
    storageKeyPrefix: "ds_chat_clone__",

    // IndexedDB 数据库名称与版本号（后续 Step 的 storage.js 中会用到）
    indexedDbName: "ds_chat_clone_db",
    indexedDbVersion: 1,

    // 压缩轮数允许的用户配置范围，供设置面板做输入校验（边界处理）
    compressionRoundsRange: { min: 5, max: 30 },

    // ---------------- 扩展预留位 ----------------
    // 后续用户若需要新增模型厂商的「预设模板」（例如一键填充某类中转接口的常见参数），
    // 可以在此处新增一个 providerPresets 数组，每项包含 name/baseUrl占位说明/备注，
    // 注意：预设模板只能是「填写引导」，禁止写死真实可用的厂商官方地址。
    providerPresets: []
  };
})();
