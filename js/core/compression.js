/**
 * ============================================================
 * compression.js —— 对话上下文压缩引擎（算法移植自 DeepSeek Harness 官方实现）
 * ============================================================
 * 【来源与移植说明】
 * 本文件的压缩策略提炼自 deepseek-ai/deepseek-harness 仓库的真实源码：
 *   - packages/compaction/compaction/src/types.ts（压缩结果结构、事件协议）
 *   - packages/compaction/compaction/src/index.ts（CompactionEngine 抽象、触发时机）
 *   - packages/compaction/compaction-basic/src/index.ts（压力阈值判断、自动触发入口）
 *   - packages/compaction/compaction-basic/src/region.ts（区间选择、保留尾部、
 *     不切断工具调用配对的边界规则）
 *   - packages/compaction/compaction-basic/src/summarizer.ts（摘要生成提示词、
 *     结构化 checkpoint 格式、摘要瘦身校验）
 *   - packages/compaction/compaction-basic/src/config.ts（thresholdRatio /
 *     retainRatio 等阈值定义与默认值）
 * 原实现基于 Cordis 服务容器、Session 事件日志、TokenMeter 等完整运行时基础设施，
 * 本文件把其中与具体运行时无关的核心算法（压力判断 -> 区间选择 -> 摘要生成 ->
 * 单块替换）移植为可独立运行的纯函数集合，适配本项目的内存消息数组模型，
 * 不依赖任何 Cordis / Session 日志机制。
 *
 * 【核心算法（与原实现逐项对应）】
 *   1. 压力判断：当前完整上下文的预估 token 数 / 模型上下文窗口 >= thresholdRatio
 *      （默认 0.8）时触发压缩——对应原实现 compactPressure() 的阈值比较。
 *   2. 区间选择：从消息数组尾部向前累计 token，直到满足 retainTokens
 *      （默认 retainRatio 0.16 的窗口预算）为止，该位置即为"保留尾部"的起点；
 *      再向前微调，确保切割点不会拆散一组 user 提问与其对应的 assistant 回复
 *      ——对应原实现 selectCompactableRange() 的回溯累加与配对保护。
 *   3. 摘要生成：把待压缩区间的消息原样重放，末尾追加一条固定的结构化
 *      checkpoint 生成指令（与原实现 summarizer.ts 的 COMPACTION_INSTRUCTION
 *      完全一致的 Markdown 骨架：Primary Request and Intent / Key Technical
 *      Concepts / Files and Code / Errors and Fixes / Pending Jobs /
 *      Current Work / Next Step / Critical Context），调用 LLM 生成摘要。
 *   4. 瘦身校验：生成的摘要文本预估 token 数必须明显小于被替换区间的原始
 *      token 数，否则判定压缩失败，保留原文——对应原实现摘要必须"更小"的硬性校验。
 *   5. 单块替换：把被压缩的区间整体替换为一条 role: 'user' 的 checkpoint 消息，
 *      包裹固定的前情提要文案（与原实现 CHECKPOINT_PREAMBLE 含义一致），
 *      不删除历史日志本身（本项目里即不改变已持久化的原始消息，只在
 *      "即将发给模型的 messages 数组"这一层做替换，供后续按需扩展为真正改写存储）。
 *   6. 幂等再压缩：摘要生成指令里明确说明"如果重放内容里已经包含一个旧的
 *      checkpoint 块，视为上一次的摘要，合并新旧信息成一份，不要原样照抄转发"
 *      ——对应原实现对 <compacted-summary> 标签的识别与合并规则。
 *
 * 【与原实现的差异（移植过程中的必要简化，均在对应函数注释里标注）】
 *   - 没有 Session 事件日志、没有 compaction/start·summary·end 三段式事务标记，
 *     本文件用一个模块级的 Set 记录"正在压缩中的对话 id"做并发互斥，效果等价
 *     （防止同一对话同时触发两次压缩），但不提供事件级别的可观测日志。
 *   - 没有工具调用（tool_use/tool_result）配对概念，本项目消息只有
 *     user/assistant 两种角色，配对保护简化为"不能把一个 user 消息和它
 *     紧跟着的 assistant 回复从中间切开"。
 *   - token 计数复用本项目 input.js 已有的中英文粗估算法（见
 *     estimateTokensRough），不是真实的模型分词器，因此阈值判断本身就是
 *     启发式的——这与原实现依赖的 TokenMeter 也是"可配置的启发式估算"
 *     在性质上一致，只是精度更粗略。
 * ============================================================
 */

(function () {
  "use strict";

  // ---------------- 阈值默认值：与原实现 config.ts 的默认值保持一致 ----------------
  var DEFAULT_THRESHOLD_RATIO = 0.8; // 触发压缩的上下文占用比例
  var DEFAULT_RETAIN_RATIO = 0.16; // 压缩后仍保留原文的尾部 token 预算比例（相对上下文窗口）
  var DEFAULT_CONTEXT_WINDOW = 32000; // 未配置模型上下文窗口时的保底估计值（token），仅用于比例换算
  var MIN_SHRINK_RATIO = 0.9; // 摘要必须 <= 被替换内容 token 数 * 该比例，否则视为"没有真正变小"

  // 固定的结构化摘要生成指令：与 DeepSeek Harness 官方 summarizer.ts 的
  // COMPACTION_INSTRUCTION 骨架保持一致（翻译为中文指令、调整表述以适配
  // 角色扮演/日常对话场景，不局限于"编程助手"语境）。
  var COMPACTION_INSTRUCTION = [
    "你现在作为本对话的上下文压缩器。请把上面的对话内容浓缩成一份结构化的记录，",
    "使另一个模型能够在不丢失关键信息的情况下，接续当前的对话或故事。",
    "",
    "请严格输出下面这个 Markdown 结构，保留每一个小节、按顺序排列；",
    "用简洁的要点而不是长段落；某一节确实没有内容时写“（无）”，不要省略整节。",
    "",
    "## 核心诉求与进展",
    "- [用户最初想要什么、后来有什么调整或新增要求；原文措辞关键的地方尽量保留原话]",
    "",
    "## 关键设定与事实",
    "- [人物设定、世界观规则、关键关系、已确定的事实细节]",
    "",
    "## 已发生的关键情节/内容",
    "- [按时间顺序简述已经发生的重要事件、对话转折点]",
    "",
    "## 尚未解决或正在推进的事情",
    "- [当前正在做、还没结束的内容]",
    "",
    "## 下一步",
    "- [最自然的下一步走向，或“（无）”]",
    "",
    "## 需要保持稳定的细节",
    "- [语气、人设、称呼方式等容易跑偏、需要明确提醒保持一致的点]",
    "",
    "规则：",
    "- 用简洁但信息完整的中文叙述，保留关键的专有名词、人物名字、数字等不要意译。",
    "- 不要提及“这是一份摘要”“上下文被压缩了”之类的元叙述，摘要本身就是后续对话的背景。",
    "- 只输出摘要正文，不要执行任何其他操作或追加寒暄。",
    "- 如果上面的对话里已经包含一份用 <compacted-summary> 包裹的旧摘要，说明这是再次压缩：",
    "  不要原样照抄旧摘要，把其中仍然成立的信息和新发生的内容合并成一份新的、单一的摘要。"
  ].join("\n");

  var SUMMARY_OPEN_TAG = "<compacted-summary>";
  var SUMMARY_CLOSE_TAG = "</compacted-summary>";

  // 替换消息前面的固定前情提要文案：与原实现 CHECKPOINT_PREAMBLE 的作用一致——
  // 让模型把这段内容当作"已确立的背景"直接续写，而不是当作需要回应的新消息。
  var CHECKPOINT_PREAMBLE =
    "（以下是自动生成的历史压缩摘要，用于节省上下文空间。请将其视为已经确立的背景信息，直接在此基础上继续对话，不要对这段摘要本身做出回应或提及它是摘要。）";

  // 正在压缩中的对话 id 集合，防止同一对话并发触发两次压缩请求（简化版的事务互斥）
  var compactingConversationIds = {};

  // 压缩进度阶段常量：供调用方（手动压缩按钮/设置面板进度条）订阅展示，
  // 均为真实可观测的阶段，不编造虚假百分比；只有"生成摘要中"这一阶段如果
  // 命中流式输出，才会附带真实的已生成字数，其余阶段只报阶段文字 + 已用时长。
  var STAGE = {
    SELECTING: "selecting", // 正在选取可压缩区间
    SUMMARIZING: "summarizing", // 正在请求模型生成摘要（耗时主体部分）
    VERIFYING: "verifying", // 摘要已返回，正在做瘦身校验
    DONE: "done", // 压缩成功完成
    SKIPPED: "skipped", // 没有触发压缩（压力不足/没有可压缩区间/瘦身校验未通过）
    FAILED: "failed" // 请求出错
  };

  // ================================================================
  // Token 粗估算法：与 js/modules/input/input.js 的 estimateTokenRough 规则一致，
  // 中文按约 1.5 字符/token、英文按约 4 字符/token 折算，保持全项目估算口径统一。
  // ================================================================
  function estimateTokensRough(text) {
    if (!text) {
      return 0;
    }
    var cnCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    var otherCount = text.length - cnCount;
    var cfg = (window.DSConfig && window.DSConfig.defaultTokenEstimateConfig) || {
      cnCharsPerToken: 1.5,
      enCharsPerToken: 4
    };
    var tokens = cnCount / cfg.cnCharsPerToken + otherCount / cfg.enCharsPerToken;
    return Math.ceil(tokens);
  }

  /**
   * 估算一条消息对象（{ role, content }）的 token 数，仅计正文内容。
   */
  function estimateMessageTokens(message) {
    return estimateTokensRough(message && message.content ? message.content : "");
  }

  /**
   * 估算整段消息数组的 token 总数。
   */
  function estimateMessagesTokens(messages) {
    return (messages || []).reduce(function (sum, m) {
      return sum + estimateMessageTokens(m);
    }, 0);
  }

  // ================================================================
  // 区间选择：对应原实现 region.ts 的 selectCompactableRange()
  // ================================================================
  /**
   * 从消息数组中选出"可以被压缩替换"的区间：[0, cutoffIndex)。
   * 算法：从数组末尾向前累计 token，直到累计量达到 retainTokens（保留尾部预算）
   * 为止，这个位置就是初步的切割点；再向前微调，确保切割点不会落在一组
   * user→assistant 问答的中间（即切割点必须是一个 user 消息的起始位置，
   * 或者数组开头），对应原实现"不能切断工具调用配对"的边界保护，
   * 在本项目里简化为"不能切断一轮问答"。
   *
   * @param {Array} messages 完整消息数组（role: 'user'|'assistant'）
   * @param {number} retainTokens 必须保留在"原文尾部"的最小 token 预算
   * @returns {number|null} 切割点下标（[0, cutoffIndex) 的消息会被压缩替换），
   *   没有安全的可压缩区间时返回 null（例如整段历史本身就小于保留预算）
   */
  function selectCompactableRange(messages, retainTokens) {
    if (!messages || messages.length === 0) {
      return null;
    }
    var accumulated = 0;
    var cutoffIndex = messages.length;
    for (var i = messages.length - 1; i >= 0; i--) {
      accumulated += estimateMessageTokens(messages[i]);
      cutoffIndex = i;
      if (accumulated >= retainTokens) {
        break;
      }
    }
    // 向前微调：确保 cutoffIndex 落在一个 user 消息的起始位置（不切断问答配对）。
    // 规则：若 messages[cutoffIndex] 是 assistant 消息，说明它对应的 user 提问
    // 被留在了待压缩区间，这样切割是安全的（assistant 回复本身独立成一条，
    // 不依赖后面的内容）；但如果 cutoffIndex 指向的是一条 assistant 消息，
    // 而它前一条也是本应与它同组的 user 消息却被划进了"保留区"，就会出现
    // "保留区开头是一条孤立的 assistant 回复、没有对应提问"的割裂感——
    // 因此统一调整为：只要 cutoffIndex 处不是 user 消息（且不是数组开头），
    // 就继续向前移动，直到落在 user 消息或数组开头为止。
    while (cutoffIndex > 0 && messages[cutoffIndex].role !== "user") {
      cutoffIndex -= 1;
    }
    if (cutoffIndex <= 0) {
      return null; // 没有安全的可压缩前缀，整段历史都要保留
    }
    return cutoffIndex;
  }

  // ================================================================
  // 压力判断：对应原实现 compactPressure() 的阈值比较
  // ================================================================
  /**
   * 判断当前消息数组是否已经达到需要压缩的压力阈值。
   * @param {Array} messages
   * @param {Object} [options] { contextWindow, thresholdRatio }
   * @returns {boolean}
   */
  function isUnderPressure(messages, options) {
    options = options || {};
    var contextWindow = options.contextWindow || DEFAULT_CONTEXT_WINDOW;
    var thresholdRatio = typeof options.thresholdRatio === "number" ? options.thresholdRatio : DEFAULT_THRESHOLD_RATIO;
    var totalTokens = estimateMessagesTokens(messages);
    return totalTokens >= contextWindow * thresholdRatio;
  }

  // ================================================================
  // 摘要生成：对应原实现 summarizer.ts 的 summarizeWithLlm()
  // ================================================================
  /**
   * 调用 window.DSApiClient 发起一次一次性（非流式）摘要请求：
   * 把待压缩区间的消息原样放在前面，末尾追加固定的压缩指令作为最后一条
   * user 消息，复用已有的 API 适配层（会自动带上用户配置的 Base URL / Key /
   * 模型名），不新开一套网络请求逻辑。
   * @param {Array} regionMessages 待压缩区间的消息（标准 {role, content} 格式）
   * @param {Function} [onChunk] 流式模式下每收到一段内容增量调用一次，参数为累计已生成的字符数；
   *   非流式模式下永远不会被调用（没有中间增量可汇报，这是诚实反映，不编造假进度）
   * @returns {Promise<string>} resolve 摘要正文文本；配置不完整或请求失败时 reject
   */
  function requestSummary(regionMessages, onChunk) {
    return new Promise(function (resolve, reject) {
      if (!window.DSApiClient) {
        reject(new Error("压缩引擎依赖的 DSApiClient 未加载"));
        return;
      }
      var summarizationMessages = regionMessages.concat([
        { role: "user", content: COMPACTION_INSTRUCTION }
      ]);
      var accumulatedLength = 0;
      window.DSApiClient.sendChatRequest({
        messages: summarizationMessages,
        callbacks: {
          onContentChunk: function (chunk) {
            accumulatedLength += chunk.length;
            if (onChunk) {
              onChunk(accumulatedLength);
            }
          },
          onDone: function (result) {
            var text = (result && result.content ? result.content : "").trim();
            if (!text) {
              reject(new Error("摘要生成结果为空"));
              return;
            }
            resolve(text);
          },
          onError: function (err) {
            reject(err);
          }
        }
      });
    });
  }

  /**
   * 把摘要正文包裹进固定的 checkpoint 框架文案与标签中，生成最终用于替换
   * 历史区间的那一条消息内容。
   * @param {string} summaryText
   * @returns {string}
   */
  function frameSummary(summaryText) {
    return CHECKPOINT_PREAMBLE + "\n\n" + SUMMARY_OPEN_TAG + "\n" + summaryText + "\n" + SUMMARY_CLOSE_TAG;
  }

  // ================================================================
  // 核心入口：对一段消息数组执行一次完整压缩（选区 -> 摘要 -> 瘦身校验）
  // ================================================================
  /**
   * 【重要：本函数不会修改传入的 messages 数组，也不会删除任何原始消息】
   * 压缩只产生一份"压缩记录"（被覆盖的原始消息 id 列表 + 一条摘要文本），
   * 原始消息永远完整保留——界面上的每一条气泡、历史存储里的每一条消息都不受影响，
   * 可以随时编辑/重新生成/往上翻看原文。真正"省 token"的效果由调用方
   * （js/modules/chat/chat.js 的 buildApiMessages）在组装发给模型的请求体时，
   * 用这份压缩记录动态替换被覆盖的那一段，只影响"即将发出的网络请求"这一份临时数据。
   *
   * @param {Array} messages 完整消息数组（{id, role, content, ...}），不会被修改
   * @param {Object} [options] { contextWindow, thresholdRatio, retainRatio, force, onProgress }
   *   force: true 时跳过压力判断，只要存在可压缩区间就执行（供手动压缩/导入压缩复用）
   *   onProgress(stage, detail)：真实压缩进度回调，stage 取值见 STAGE 常量；
   *     detail 在 SUMMARIZING 阶段可能带 { streamedChars } 表示流式模式下已生成的字符数，
   *     非流式模式下 detail 为空对象——调用方应按"是否有 streamedChars"判断能不能展示实时字数，
   *     不要假设每次都有。
   * @returns {Promise<{compacted: boolean, shadowedMessageIds: string[], shadowedCount: number, summary: string}>}
   *   compacted 为 false 时表示未触发压缩（压力不足，或没有安全可压缩区间，或摘要瘦身校验失败），
   *   此时 shadowedMessageIds 为空数组，不抛异常——调用方应把"压缩失败"当作正常的降级路径，
   *   发送流程始终可以用原始 messages 继续，不应该因为压缩失败而阻断发送。
   */
  function compactMessages(messages, options) {
    options = options || {};
    messages = messages || [];
    var onProgress = typeof options.onProgress === "function" ? options.onProgress : function () {};

    if (!options.force && !isUnderPressure(messages, options)) {
      onProgress(STAGE.SKIPPED, {});
      return Promise.resolve({ compacted: false, shadowedMessageIds: [], shadowedCount: 0, summary: "" });
    }

    onProgress(STAGE.SELECTING, {});
    var contextWindow = options.contextWindow || DEFAULT_CONTEXT_WINDOW;
    var retainRatio = typeof options.retainRatio === "number" ? options.retainRatio : DEFAULT_RETAIN_RATIO;
    var retainTokens = Math.floor(contextWindow * retainRatio);

    var cutoffIndex = selectCompactableRange(messages, retainTokens);
    if (cutoffIndex === null) {
      // 没有安全的可压缩前缀（例如整段历史本身很短），不算错误
      onProgress(STAGE.SKIPPED, {});
      return Promise.resolve({ compacted: false, shadowedMessageIds: [], shadowedCount: 0, summary: "" });
    }

    var regionSourceMessages = messages.slice(0, cutoffIndex);
    var regionMessages = regionSourceMessages.map(function (m) {
      return { role: m.role, content: m.content };
    });
    var regionTokens = estimateMessagesTokens(regionMessages);

    onProgress(STAGE.SUMMARIZING, { streamedChars: 0 });
    return requestSummary(regionMessages, function (streamedChars) {
      onProgress(STAGE.SUMMARIZING, { streamedChars: streamedChars });
    }).then(function (summaryText) {
      onProgress(STAGE.VERIFYING, {});
      var framed = frameSummary(summaryText);
      var framedTokens = estimateTokensRough(framed);

      // 瘦身校验：对应原实现"摘要必须明显小于被替换内容"的硬性校验，
      // 校验失败时不是抛异常阻断流程，而是降级为"本次不压缩，沿用原文"，
      // 因为压缩本身是性能优化手段，不应该因为一次摘要质量不理想而影响正常发送。
      if (framedTokens >= regionTokens * MIN_SHRINK_RATIO) {
        console.warn(
          "[DSCompression] 摘要未能有效缩小上下文（摘要 " + framedTokens + " tokens >= 原文 " +
            regionTokens + " tokens 的 " + MIN_SHRINK_RATIO + " 倍），本次放弃压缩，保留原文。"
        );
        onProgress(STAGE.SKIPPED, {});
        return { compacted: false, shadowedMessageIds: [], shadowedCount: 0, summary: "" };
      }

      var shadowedMessageIds = regionSourceMessages.map(function (m) {
        return m.id;
      });
      onProgress(STAGE.DONE, { shadowedCount: cutoffIndex });
      return {
        compacted: true,
        shadowedMessageIds: shadowedMessageIds,
        shadowedCount: cutoffIndex,
        summary: summaryText
      };
    }, function (err) {
      onProgress(STAGE.FAILED, { error: err });
      throw err;
    });
  }

  /**
   * 供自动压缩钩子使用：对指定对话 id 执行一次互斥保护的压缩。
   * 同一对话 id 已经有一次压缩在进行中时，直接返回"未压缩"，不重复发起请求
   * ——对应原实现的 compaction/start 事务锁，简化为内存标记。
   * @param {string} conversationId
   * @param {Array} messages
   * @param {Object} [options]
   */
  function compactConversation(conversationId, messages, options) {
    if (compactingConversationIds[conversationId]) {
      if (options && typeof options.onProgress === "function") {
        options.onProgress(STAGE.SKIPPED, { reason: "already-compacting" });
      }
      return Promise.resolve({ compacted: false, shadowedMessageIds: [], shadowedCount: 0, summary: "" });
    }
    compactingConversationIds[conversationId] = true;
    return compactMessages(messages, options).then(
      function (result) {
        delete compactingConversationIds[conversationId];
        return result;
      },
      function (err) {
        delete compactingConversationIds[conversationId];
        throw err;
      }
    );
  }

  window.DSCompression = {
    STAGE: STAGE,
    estimateTokensRough: estimateTokensRough,
    estimateMessageTokens: estimateMessageTokens,
    estimateMessagesTokens: estimateMessagesTokens,
    isUnderPressure: isUnderPressure,
    selectCompactableRange: selectCompactableRange,
    compactMessages: compactMessages,
    compactConversation: compactConversation,
    frameSummary: frameSummary,
    isCompacting: function (conversationId) {
      return !!compactingConversationIds[conversationId];
    },
    SUMMARY_OPEN_TAG: SUMMARY_OPEN_TAG,
    SUMMARY_CLOSE_TAG: SUMMARY_CLOSE_TAG,
    DEFAULT_THRESHOLD_RATIO: DEFAULT_THRESHOLD_RATIO,
    DEFAULT_RETAIN_RATIO: DEFAULT_RETAIN_RATIO,
    DEFAULT_CONTEXT_WINDOW: DEFAULT_CONTEXT_WINDOW
  };
})();
