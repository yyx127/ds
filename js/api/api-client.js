/**
 * ============================================================
 * api-client.js —— 通用 API 请求适配层（Step 5 核心模块）
 * ============================================================
 * 设计原则（严格对齐需求文档「四、通用 API 适配层」）：
 *   - 完全不绑定任何具体厂商：Base URL / API Key / 模型名 / 各类参数
 *     全部从 window.DSUserConfig（本地配置读写模块）读取，本文件内
 *     不出现任何写死的厂商官方地址或模型名。
 *   - 默认兼容 OpenAI 标准请求体格式与 SSE 流式响应格式，
 *     同时通过「请求拦截 / 响应拦截」两个钩子函数，支持用户按需适配
 *     非标准中转接口（钩子位置见下方 REQUEST_INTERCEPTOR / RESPONSE_INTERCEPTOR）。
 *   - 响应字段路径（内容/思考/错误）通过 responseFieldMap 配置项动态读取，
 *     不写死具体 JSON 结构，兼容各类返回格式差异的中转服务。
 *   - 统一错误处理：网络错误、鉴权失败、限流、参数错误、服务器异常、超时，
 *     分别产生带有明确中文提示的错误对象，由调用方（chat.js）展示为 Toast。
 *   - 支持通过 AbortController 中断请求（配合聊天区的“停止生成”按钮）。
 *
 * 本文件不做任何本地持久化、不做对话压缩，只负责「发请求 -> 解析响应 -> 回调」。
 * ============================================================
 */

(function () {
  "use strict";

  // ================================================================
  // 错误类型定义：统一的错误对象结构，带有 type 字段方便上层按类型展示不同文案
  // ================================================================
  var ERROR_TYPE = {
    NETWORK: "network", // 网络连接失败（DNS、断网、CORS 等 fetch 直接 reject 的情况）
    AUTH: "auth", // 鉴权失败（401/403）
    RATE_LIMIT: "rate_limit", // 限流（429）
    PARAM: "param", // 参数错误（400/422）
    SERVER: "server", // 服务器异常（5xx）
    TIMEOUT: "timeout", // 请求超时
    ABORT: "abort", // 用户主动中断（停止生成），不算“错误”，但统一走同一通道方便调用方识别
    CONFIG_MISSING: "config_missing", // 本地配置不完整（未填 Base URL / 模型名）
    PARSE: "parse", // 响应解析失败（字段路径取不到值等）
    UNKNOWN: "unknown"
  };

  /**
   * 根据 HTTP 状态码与可能解析出的错误信息，构建统一的错误对象。
   * @param {string} type
   * @param {string} message 面向用户的中文提示
   * @param {Object} [extra] 附加信息（如原始状态码、原始响应体），便于调试但不展示给用户
   */
  function buildError(type, message, extra) {
    var err = new Error(message);
    err.dsErrorType = type;
    err.dsExtra = extra || null;
    return err;
  }

  // ================================================================
  // 按 JSON 路径字符串（点号分隔，支持数组下标）从对象中取值
  // ================================================================
  /**
   * @param {Object} obj
   * @param {string} path 形如 "choices.0.message.content"
   * @returns {*} 取不到时返回 undefined，不抛异常（调用方自行判断边界）
   */
  function getByPath(obj, path) {
    if (!obj || !path) {
      return undefined;
    }
    var segments = path.split(".");
    var cur = obj;
    for (var i = 0; i < segments.length; i++) {
      if (cur == null) {
        return undefined;
      }
      cur = cur[segments[i]];
    }
    return cur;
  }

  // ================================================================
  // 【扩展预留位 1】请求拦截钩子
  // ================================================================
  // 用户可以在这里修改最终发出的请求体 / 请求头，用于适配非标准中转接口
  // （例如某些中转服务要求把 model 字段改名为别的 key，或者需要额外注入固定参数）。
  // 约定：接收 (requestBody, context)，必须返回修改后的 requestBody（不修改则原样返回）。
  // context 包含 { config, messages }，可用于按需读取当前配置或消息上下文做条件判断。
  function REQUEST_INTERCEPTOR(requestBody, context) {
    // ↓↓↓ 在此处按需修改 requestBody，例如：
    // requestBody.custom_field = 'xxx';
    return requestBody;
  }

  // ================================================================
  // 【扩展预留位 2】响应拦截钩子
  // ================================================================
  // 用户可以在这里对「单个已解析出的 SSE data JSON 对象」或「非流式完整响应 JSON」
  // 做二次处理，例如某些中转接口返回的增量字段不是标准的 delta.content，
  // 可以在这里把真实字段映射挪到标准位置上，再交给后续统一的字段路径读取逻辑处理。
  // 约定：接收 (parsedJson, context)，必须返回处理后的 parsedJson。
  function RESPONSE_INTERCEPTOR(parsedJson, context) {
    // ↓↓↓ 在此处按需修改 parsedJson 结构，例如：
    // if (parsedJson.my_custom_delta) { parsedJson.choices = [{ delta: { content: parsedJson.my_custom_delta } }]; }
    return parsedJson;
  }

  // ================================================================
  // 构建请求体（标准 OpenAI 格式：messages 数组 + 模型参数）
  // ================================================================
  /**
   * @param {Array} messages 标准格式的消息数组：[{ role: 'system'|'user'|'assistant', content: string }, ...]
   * @param {Object} config 当前生效的 API 配置（来自 DSUserConfig.getApiConfig）
   * @returns {Object}
   */
  function buildRequestBody(messages, config) {
    var body = {
      model: config.model,
      messages: messages,
      // 温度与最大生成长度均从 config 读取，不写死任何默认业务值（config.js 中已提供通用默认）
      temperature: typeof config.temperature === "number" ? config.temperature : 1.0,
      max_tokens: typeof config.maxTokens === "number" ? config.maxTokens : 2048,
      stream: !!config.stream
    };
    // 深度思考模式：不同厂商字段名差异很大，这里采用一个通用的占位字段名 enable_thinking，
    // 用户若对接的接口字段名不同，可通过请求拦截钩子（REQUEST_INTERCEPTOR）自行改名适配。
    if (config.enableThinking) {
      body.enable_thinking = true;
    }
    return REQUEST_INTERCEPTOR(body, { config: config, messages: messages });
  }

  /**
   * 构建请求头：固定的 Content-Type + Authorization（若配置了 API Key）+ 用户自定义头。
   * @param {Object} config
   */
  function buildHeaders(config) {
    var headers = { "Content-Type": "application/json" };
    if (config.apiKey && config.apiKey.trim()) {
      headers["Authorization"] = "Bearer " + config.apiKey.trim();
    }
    if (Array.isArray(config.customHeaders)) {
      config.customHeaders.forEach(function (item) {
        if (item && item.key) {
          headers[item.key] = item.value || "";
        }
      });
    }
    return headers;
  }

  /**
   * 拼接完整请求 URL：若 baseUrl 已包含具体的 chat/completions 路径则直接使用，
   * 否则按 OpenAI 标准约定自动补全 /chat/completions 路径，
   * 兼容用户可能填写“到域名为止”或“已包含完整路径”两种常见填写习惯（边界处理）。
   * @param {string} baseUrl
   */
  function buildRequestUrl(baseUrl) {
    var trimmed = (baseUrl || "").trim().replace(/\/+$/, "");
    if (/\/(chat\/completions|completions)$/i.test(trimmed)) {
      return trimmed;
    }
    return trimmed + "/chat/completions";
  }

  // ================================================================
  // 根据 HTTP 响应状态码分类错误
  // ================================================================
  /**
   * @param {Response} response fetch 的 Response 对象
   * @param {Object|null} parsedBody 尝试解析出的 JSON 错误体（可能为 null）
   * @param {Object} config
   */
  function classifyHttpError(response, parsedBody, config) {
    var status = response.status;
    var serverMsg = parsedBody ? getByPath(parsedBody, config.responseFieldMap.errorPath) : null;
    if (status === 401 || status === 403) {
      return buildError(ERROR_TYPE.AUTH, "密钥验证失败，请检查设置中的 API Key 是否正确", {
        status: status,
        serverMsg: serverMsg
      });
    }
    if (status === 429) {
      return buildError(ERROR_TYPE.RATE_LIMIT, "请求过于频繁，已被限流，请稍后再试", {
        status: status,
        serverMsg: serverMsg
      });
    }
    if (status === 400 || status === 422) {
      return buildError(
        ERROR_TYPE.PARAM,
        "请求参数有误" + (serverMsg ? "：" + serverMsg : "，请检查模型名称与请求参数设置"),
        { status: status, serverMsg: serverMsg }
      );
    }
    if (status >= 500) {
      return buildError(ERROR_TYPE.SERVER, "服务器发生异常（状态码 " + status + "），请稍后重试", {
        status: status,
        serverMsg: serverMsg
      });
    }
    return buildError(
      ERROR_TYPE.UNKNOWN,
      "请求失败（状态码 " + status + "）" + (serverMsg ? "：" + serverMsg : ""),
      { status: status, serverMsg: serverMsg }
    );
  }

  // ================================================================
  // SSE 流式响应解析
  // ================================================================
  /**
   * 解析标准 SSE 格式的响应流，逐段触发回调。
   * SSE 约定：以 "data: " 开头的行携带一段 JSON（或字符串 "[DONE]" 表示结束），
   * 不同事件之间以空行分隔。这里采用增量读取 + 按换行切分缓冲区的方式处理，
   * 不依赖浏览器的 EventSource（因为 EventSource 不支持自定义 Header 鉴权，
   * 而中转接口通常需要 Authorization 头，所以改用 fetch + ReadableStream 手动解析）。
   *
   * @param {Response} response
   * @param {Object} config
   * @param {Object} callbacks { onContentChunk, onThinkingChunk }
   * @param {AbortSignal} signal
   */
  function parseSseStream(response, config, callbacks, signal) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder("utf-8");
    var buffer = "";

    function processLine(line) {
      line = line.trim();
      if (!line || line.indexOf("data:") !== 0) {
        return; // 忽略空行与非 data 行（如 SSE 的 event: / id: 字段，标准聊天接口通常不使用）
      }
      var dataStr = line.slice(5).trim();
      if (dataStr === "[DONE]") {
        return; // 结束标记，由外层读取循环的 done 状态统一处理，这里不重复触发完成回调
      }
      var json;
      try {
        json = JSON.parse(dataStr);
      } catch (err) {
        // 边界处理：个别中转接口可能在流中混入非 JSON 的调试文本，忽略单行解析失败，不中断整个流
        console.warn("[DSApiClient] 忽略一行无法解析的 SSE 数据：", dataStr);
        return;
      }
      json = RESPONSE_INTERCEPTOR(json, { config: config });

      var contentDelta = getByPath(json, config.responseFieldMap.streamContentPath);
      var thinkingDelta = getByPath(json, config.responseFieldMap.streamThinkingPath);
      if (typeof contentDelta === "string" && contentDelta) {
        callbacks.onContentChunk(contentDelta);
      }
      if (typeof thinkingDelta === "string" && thinkingDelta) {
        callbacks.onThinkingChunk(thinkingDelta);
      }
    }

    function pump() {
      return reader.read().then(function (result) {
        if (signal && signal.aborted) {
          // 用户点击了停止：主动取消底层读取，避免连接继续占用资源
          return reader.cancel();
        }
        if (result.done) {
          // 处理缓冲区中可能残留的最后一行（没有以换行结尾的情况）
          if (buffer) {
            processLine(buffer);
          }
          return;
        }
        buffer += decoder.decode(result.value, { stream: true });
        var lines = buffer.split("\n");
        // 最后一段可能是不完整的行，留在 buffer 中等待下一次读取拼接
        buffer = lines.pop();
        lines.forEach(processLine);
        return pump();
      });
    }

    return pump();
  }

  // ================================================================
  // 非流式响应解析
  // ================================================================
  function parseNonStreamResponse(json, config) {
    json = RESPONSE_INTERCEPTOR(json, { config: config });
    var content = getByPath(json, config.responseFieldMap.contentPath);
    var thinking = getByPath(json, config.responseFieldMap.thinkingPath);
    if (typeof content !== "string") {
      throw buildError(
        ERROR_TYPE.PARSE,
        "无法从响应中解析出回复内容，请检查设置中的「响应字段映射」配置是否与接口实际返回结构一致",
        { rawResponse: json }
      );
    }
    return { content: content, thinking: typeof thinking === "string" ? thinking : "" };
  }

  // ================================================================
  // 发起带超时与重试的 fetch 请求
  // ================================================================
  /**
   * @param {string} url
   * @param {Object} fetchOptions 标准 fetch 第二参数（headers/body/signal 等）
   * @param {number} timeoutMs
   * @param {AbortController} abortController 外部传入的中断控制器（供“停止生成”复用同一个信号）
   */
  function fetchWithTimeout(url, fetchOptions, timeoutMs, abortController) {
    var timeoutId = setTimeout(function () {
      abortController.abort();
    }, timeoutMs);

    return fetch(url, Object.assign({}, fetchOptions, { signal: abortController.signal }))
      .then(function (response) {
        clearTimeout(timeoutId);
        return response;
      })
      .catch(function (err) {
        clearTimeout(timeoutId);
        throw err;
      });
  }

  /**
   * 带「网络异常自动重试 1 次」语义的请求执行器。
   * 仅对「网络层面直接失败」（fetch reject，非超时、非用户主动中断）的情况重试，
   * HTTP 状态码错误（4xx/5xx）不重试，因为重试无法改变鉴权失败/参数错误的结果。
   * @param {Function} doFetch 返回 Promise<Response> 的函数，每次调用都会发起一次新请求
   * @param {number} retryTimes
   * @param {() => boolean} isAborted 外部中断状态查询（用户点了停止时不应继续重试）
   */
  function fetchWithRetry(doFetch, retryTimes, isAborted) {
    return doFetch().catch(function (err) {
      if (isAborted()) {
        throw err; // 用户主动中断，不重试，原样抛出（由上层识别为 abort 类型）
      }
      if (err.name === "AbortError") {
        throw err; // 超时也会表现为 AbortError，不在这里重试（超时错误已有明确提示，重试意义不大且会延长等待）
      }
      if (retryTimes > 0) {
        console.warn("[DSApiClient] 网络请求失败，自动重试一次：", err);
        return doFetch();
      }
      throw err;
    });
  }

  // ================================================================
  // 核心入口：发起一次对话请求（自动判断流式/非流式）
  // ================================================================
  /**
   * @param {Object} options
   * @param {Array} options.messages 标准消息数组（已包含 system 提示词，由调用方组装好）
   * @param {Object} options.callbacks
   *   onContentChunk(text) —— 流式模式下，每收到一段内容增量时调用
   *   onThinkingChunk(text) —— 流式模式下，每收到一段思考内容增量时调用
   *   onDone(result) —— 请求成功完成时调用，result = { content, thinking }（非流式/流式结束后的完整文本）
   *   onError(error) —— 发生任意错误时调用，error.dsErrorType 标识错误分类
   * @returns {{ abort: Function }} 返回一个控制器，调用 abort() 可中断当前请求（供“停止生成”按钮使用）
   */
  function sendChatRequest(options) {
    var messages = options.messages || [];
    var callbacks = options.callbacks || {};
    var onContentChunk = callbacks.onContentChunk || function () {};
    var onThinkingChunk = callbacks.onThinkingChunk || function () {};
    var onDone = callbacks.onDone || function () {};
    var onError = callbacks.onError || function () {};

    var config = window.DSUserConfig ? window.DSUserConfig.getApiConfig() : null;
    var abortController = new AbortController();
    var manuallyAborted = false;

    // 边界处理：本地配置不完整（未填 Base URL / 模型名）时，直接走错误回调，不发出任何网络请求
    if (!config || !config.baseUrl || !config.baseUrl.trim() || !config.model || !config.model.trim()) {
      setTimeout(function () {
        onError(
          buildError(
            ERROR_TYPE.CONFIG_MISSING,
            "尚未配置 API 地址或模型名称，请先在设置中填写后再发送消息"
          )
        );
      }, 0);
      return { abort: function () {} };
    }

    var url = buildRequestUrl(config.baseUrl);
    var headers = buildHeaders(config);
    var body = buildRequestBody(messages, config);
    var timeoutMs = typeof config.timeoutMs === "number" ? config.timeoutMs : 60000;
    var retryTimes = typeof config.retryTimes === "number" ? config.retryTimes : 1;

    function doFetch() {
      return fetchWithTimeout(
        url,
        { method: "POST", headers: headers, body: JSON.stringify(body) },
        timeoutMs,
        abortController
      );
    }

    fetchWithRetry(doFetch, retryTimes, function () {
      return manuallyAborted;
    })
      .then(function (response) {
        if (!response.ok) {
          // 非 2xx：尝试解析错误体（JSON），解析失败则 parsedBody 为 null，不影响错误分类主流程
          return response
            .json()
            .catch(function () {
              return null;
            })
            .then(function (parsedBody) {
              throw classifyHttpError(response, parsedBody, config);
            });
        }

        if (config.stream) {
          var fullContent = "";
          var fullThinking = "";
          return parseSseStream(
            response,
            config,
            {
              onContentChunk: function (chunk) {
                fullContent += chunk;
                onContentChunk(chunk);
              },
              onThinkingChunk: function (chunk) {
                fullThinking += chunk;
                onThinkingChunk(chunk);
              }
            },
            abortController.signal
          ).then(function () {
            if (manuallyAborted) {
              // 流式读取被主动中断：仍然把已经接收到的部分内容回传给调用方收口展示，
              // 而不是直接丢弃（符合“停止后保留已生成内容”的产品预期）
              throw buildError(ERROR_TYPE.ABORT, "已停止生成", {
                partialContent: fullContent,
                partialThinking: fullThinking
              });
            }
            onDone({ content: fullContent, thinking: fullThinking });
          });
        }

        // 非流式：一次性读取完整 JSON 并解析
        return response.json().then(function (json) {
          var result = parseNonStreamResponse(json, config);
          onDone(result);
        });
      })
      .catch(function (err) {
        if (err && err.dsErrorType) {
          // 已经是本模块分类过的标准错误对象，直接转交
          onError(err);
          return;
        }
        if (err && err.name === "AbortError") {
          if (manuallyAborted) {
            onError(buildError(ERROR_TYPE.ABORT, "已停止生成"));
          } else {
            onError(buildError(ERROR_TYPE.TIMEOUT, "请求超时（超过 " + Math.round(timeoutMs / 1000) + " 秒未响应），已自动中断"));
          }
          return;
        }
        // 其余归类为网络层错误（断网、DNS 失败、CORS 被拒等 fetch 直接 reject 的情况）
        onError(
          buildError(ERROR_TYPE.NETWORK, "网络连接失败，请检查网络状况或 API 地址是否正确", {
            rawMessage: err && err.message
          })
        );
      });

    return {
      abort: function () {
        manuallyAborted = true;
        abortController.abort();
      }
    };
  }

  window.DSApiClient = {
    ERROR_TYPE: ERROR_TYPE,
    sendChatRequest: sendChatRequest,
    // 导出部分内部工具函数，供单元调试 / 未来扩展直接复用，避免重复实现
    getByPath: getByPath,
    buildRequestUrl: buildRequestUrl
  };
})();
