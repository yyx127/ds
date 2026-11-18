/**
 * ============================================================
 * conversation-backgrounds.js —— 会话独立背景图 + 滤镜（核心能力）
 * ============================================================
 * 职责：
 *   1. 每个会话可以单独设置一张背景图（本地上传或内置预设）+ 四个滤镜参数
 *      （模糊、亮度、对比度）+ 一个铺满方式（平铺 / 填充 / 居中 / 拉伸）
 *   2. 背景图原始数据（Blob）存 IndexedDB（见 js/core/db.js），
 *      滤镜参数这类小体量数据随背景记录一起存，不单独拆到 localStorage
 *   3. 上传时做尺寸压缩（限制最大边长），避免把用户随手拍的几十 MB 原图
 *      直接塞进 IndexedDB，兼顾"抗重复加载"——同一张图只解码一次，
 *      之后反复切换会话时从内存缓存的 blob URL 直接取用，不重新读 IndexedDB
 *   4. 内置几套预设背景（鲸鱼/深海/星云/流体渐变），纯 CSS 渐变绘制，
 *      不占用任何图片资源体积，选中即生效，不需要上传
 *
 * 【关于"会话 id 是否稳定"的边界说明】
 * 当前版本对话列表（sidebar.js）本身尚未持久化，刷新页面后会话 id 会重置为
 * mock-data.js 里固定的几个 id 或新生成的随机 id。本模块按会话 id 存取背景，
 * 这意味着：
 *   - mock-data.js 里固定 id（mock-1 ~ mock-6）的会话，背景设置可以跨刷新保留；
 *   - 用户新建的对话（随机 id，且本身不持久化），背景设置在刷新后会和对话本身
 *     一起"消失"（因为那个 id 的对话已经不存在了，不是背景丢了）。
 * 等到后续 Step 把会话列表接入真正的持久化后，这里不需要任何改动就能自动获得
 * "新建对话的背景也能跨刷新保留"的效果，因为背景始终是按会话 id 存取的。
 * ============================================================
 */

(function () {
  "use strict";

  // IndexedDB 里每条背景记录的 key 前缀，避免和其他功能未来可能用到的 key 冲突
  var KEY_PREFIX = "conv_bg__";

  // 上传图片压缩后的最大边长（像素），超过则按比例缩小，控制 IndexedDB 占用
  var MAX_IMAGE_DIMENSION = 1600;
  // 压缩导出时的 JPEG 质量
  var COMPRESS_QUALITY = 0.82;

  // 内存缓存：会话 id -> { settings, blobUrl }，避免重复读取 IndexedDB 与重复创建 blob URL
  var cache = {};

  /**
   * 内置预设背景：纯 CSS 渐变，不需要任何图片资源。
   * value 是直接可用的 CSS background 值（渐变/径向渐变组合）。
   */
  var PRESETS = [
    {
      id: "whale-deep-sea",
      label: "鲸鱼深海",
      preview: "linear-gradient(160deg, #0b2a4a 0%, #124a73 45%, #1c6f8c 100%)",
      value:
        "radial-gradient(circle at 70% 20%, rgba(255,255,255,0.08), transparent 45%), " +
        "linear-gradient(160deg, #0b2a4a 0%, #124a73 45%, #1c6f8c 100%)"
    },
    {
      id: "nebula",
      label: "星云",
      preview: "linear-gradient(135deg, #1b1038 0%, #3a1d6b 50%, #6a3fa0 100%)",
      value:
        "radial-gradient(circle at 25% 75%, rgba(255,255,255,0.06), transparent 40%), " +
        "linear-gradient(135deg, #1b1038 0%, #3a1d6b 50%, #6a3fa0 100%)"
    },
    {
      id: "soft-fluid",
      label: "淡流体渐变",
      preview: "linear-gradient(135deg, #e9f3ff 0%, #f3e9ff 50%, #e9fff6 100%)",
      value: "linear-gradient(135deg, #e9f3ff 0%, #f3e9ff 50%, #e9fff6 100%)"
    },
    {
      id: "ocean-surface",
      label: "海面微光",
      preview: "linear-gradient(160deg, #cfe9f7 0%, #9fd1e8 50%, #6fb3d6 100%)",
      value:
        "radial-gradient(circle at 80% 15%, rgba(255,255,255,0.35), transparent 35%), " +
        "linear-gradient(160deg, #cfe9f7 0%, #9fd1e8 50%, #6fb3d6 100%)"
    }
  ];

  var DEFAULT_SETTINGS = {
    type: "none", // 'none' | 'preset' | 'upload'
    presetId: null,
    fit: "cover", // 'cover'(填充) | 'contain'(居中) | 'repeat'(平铺) | 'stretch'(拉伸)
    blur: 0, // 0~20px
    brightness: 100, // 50~150（百分比）
    contrast: 100 // 50~150（百分比）
  };

  function getStorageKey(conversationId) {
    return KEY_PREFIX + conversationId;
  }

  /**
   * 读取指定会话的背景设置（含图片 blob，若有）。
   * 优先走内存缓存；缓存未命中时读 IndexedDB 并回填缓存。
   * @param {string} conversationId
   * @returns {Promise<Object>} 结构：{ settings, blobUrl }，无记录时 settings 为 DEFAULT_SETTINGS 的拷贝、blobUrl 为 null
   */
  function getBackground(conversationId) {
    if (cache[conversationId]) {
      return Promise.resolve(cache[conversationId]);
    }
    if (!window.DSDb) {
      return Promise.resolve({ settings: Object.assign({}, DEFAULT_SETTINGS), blobUrl: null });
    }
    return window.DSDb
      .get(getStorageKey(conversationId))
      .then(function (record) {
        if (!record) {
          var empty = { settings: Object.assign({}, DEFAULT_SETTINGS), blobUrl: null };
          cache[conversationId] = empty;
          return empty;
        }
        var blobUrl = record.imageBlob ? URL.createObjectURL(record.imageBlob) : null;
        var result = { settings: record.settings, blobUrl: blobUrl };
        cache[conversationId] = result;
        return result;
      })
      .catch(function (err) {
        // 边界处理：IndexedDB 读取失败（极少数隐私模式/存储异常）时静默降级为无背景，
        // 不影响聊天区正常显示，只是没有背景图
        console.warn("[DSConvBackgrounds] 读取会话背景失败，降级为无背景：", err);
        return { settings: Object.assign({}, DEFAULT_SETTINGS), blobUrl: null };
      });
  }

  /**
   * 把一个 File/Blob 压缩为限定最大边长的 JPEG Blob，避免原图过大占用存储空间。
   * 用 <canvas> 做等比缩放重绘，兼容 Chrome/Edge/Safari（含移动端）。
   * @param {Blob} file
   * @returns {Promise<Blob>}
   */
  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var objectUrl = URL.createObjectURL(file);
      img.onload = function () {
        var width = img.naturalWidth;
        var height = img.naturalHeight;
        var scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height));
        var targetWidth = Math.round(width * scale);
        var targetHeight = Math.round(height * scale);

        var canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        canvas.toBlob(
          function (blob) {
            URL.revokeObjectURL(objectUrl);
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error("图片压缩失败：无法导出 Blob"));
            }
          },
          "image/jpeg",
          COMPRESS_QUALITY
        );
      };
      img.onerror = function () {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("图片解码失败，可能不是受支持的图片格式"));
      };
      img.src = objectUrl;
    });
  }

  /**
   * 设置指定会话为"本地上传图片"背景。
   * @param {string} conversationId
   * @param {File} file
   * @param {Object} [filterSettings] 可选的滤镜参数（fit/blur/brightness/contrast），缺省沿用默认值
   * @returns {Promise<{settings: Object, blobUrl: string}>}
   */
  function setUploadBackground(conversationId, file, filterSettings) {
    return compressImage(file).then(function (compressedBlob) {
      var settings = Object.assign({}, DEFAULT_SETTINGS, filterSettings || {}, {
        type: "upload",
        presetId: null
      });
      var record = { imageBlob: compressedBlob, settings: settings };
      return (window.DSDb ? window.DSDb.put(getStorageKey(conversationId), record) : Promise.resolve()).then(
        function () {
          // 释放旧的 blob URL（若存在），避免内存泄漏
          if (cache[conversationId] && cache[conversationId].blobUrl) {
            URL.revokeObjectURL(cache[conversationId].blobUrl);
          }
          var blobUrl = URL.createObjectURL(compressedBlob);
          var result = { settings: settings, blobUrl: blobUrl };
          cache[conversationId] = result;
          return result;
        }
      );
    });
  }

  /**
   * 设置指定会话为内置预设背景（纯 CSS 渐变，不涉及图片存储）。
   * @param {string} conversationId
   * @param {string} presetId
   * @param {Object} [filterSettings]
   */
  function setPresetBackground(conversationId, presetId, filterSettings) {
    var settings = Object.assign({}, DEFAULT_SETTINGS, filterSettings || {}, {
      type: "preset",
      presetId: presetId
    });
    var record = { imageBlob: null, settings: settings };
    return (window.DSDb ? window.DSDb.put(getStorageKey(conversationId), record) : Promise.resolve()).then(
      function () {
        if (cache[conversationId] && cache[conversationId].blobUrl) {
          URL.revokeObjectURL(cache[conversationId].blobUrl);
        }
        var result = { settings: settings, blobUrl: null };
        cache[conversationId] = result;
        return result;
      }
    );
  }

  /**
   * 仅更新滤镜参数（模糊/亮度/对比度/铺满方式），不改变背景图本身。
   * 若该会话当前没有任何背景（type: 'none'），滤镜调节没有意义，直接返回当前状态不做写入。
   */
  function updateFilterSettings(conversationId, filterPartial) {
    return getBackground(conversationId).then(function (current) {
      if (current.settings.type === "none") {
        return current;
      }
      var nextSettings = Object.assign({}, current.settings, filterPartial);
      if (!window.DSDb) {
        cache[conversationId] = { settings: nextSettings, blobUrl: current.blobUrl };
        return cache[conversationId];
      }
      return window.DSDb.get(getStorageKey(conversationId)).then(function (record) {
        var nextRecord = Object.assign({}, record, { settings: nextSettings });
        return window.DSDb.put(getStorageKey(conversationId), nextRecord).then(function () {
          var result = { settings: nextSettings, blobUrl: current.blobUrl };
          cache[conversationId] = result;
          return result;
        });
      });
    });
  }

  /**
   * 清除指定会话的背景设置，恢复为默认（无背景）。
   */
  function clearBackground(conversationId) {
    if (cache[conversationId] && cache[conversationId].blobUrl) {
      URL.revokeObjectURL(cache[conversationId].blobUrl);
    }
    delete cache[conversationId];
    if (!window.DSDb) {
      return Promise.resolve();
    }
    return window.DSDb.remove(getStorageKey(conversationId));
  }

  /**
   * 根据背景设置，计算出可以直接赋给某个容器 style 的一组 CSS 属性。
   * @param {Object} settings
   * @param {string|null} blobUrl
   * @returns {Object} 可直接 Object.assign 到 element.style 上的键值对
   */
  function computeBackgroundStyle(settings, blobUrl) {
    if (settings.type === "none") {
      return { backgroundImage: "", filter: "" };
    }

    var imageValue =
      settings.type === "preset"
        ? (PRESETS.filter(function (p) {
            return p.id === settings.presetId;
          })[0] || PRESETS[0]).value
        : blobUrl
          ? 'url("' + blobUrl + '")'
          : "";

    var sizeMap = {
      cover: "cover",
      contain: "contain",
      stretch: "100% 100%",
      repeat: "auto"
    };
    var repeatMap = {
      cover: "no-repeat",
      contain: "no-repeat",
      stretch: "no-repeat",
      repeat: "repeat"
    };

    return {
      backgroundImage: imageValue,
      backgroundSize: sizeMap[settings.fit] || "cover",
      backgroundRepeat: repeatMap[settings.fit] || "no-repeat",
      backgroundPosition: "center",
      // 模糊/亮度/对比度合并为一个 filter，三者互不冲突，可以同时生效
      filter:
        "blur(" + (settings.blur || 0) + "px) " +
        "brightness(" + (settings.brightness || 100) + "%) " +
        "contrast(" + (settings.contrast || 100) + "%)"
    };
  }

  window.DSConvBackgrounds = {
    PRESETS: PRESETS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    getBackground: getBackground,
    setUploadBackground: setUploadBackground,
    setPresetBackground: setPresetBackground,
    updateFilterSettings: updateFilterSettings,
    clearBackground: clearBackground,
    computeBackgroundStyle: computeBackgroundStyle
  };
})();
