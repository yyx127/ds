/**
 * ============================================================
 * db.js —— 轻量 IndexedDB 封装（核心基础设施）
 * ============================================================
 * 职责：提供一个极简的 Promise 化 IndexedDB 读写接口，供需要存储
 * 较大二进制数据（图片 blob 等，localStorage 存不下也不适合存）的模块使用。
 * 当前第一个使用方是 js/core/conversation-backgrounds.js（会话独立背景图）。
 *
 * 【重要边界说明】
 * 本项目目前为止，对话本身（js/modules/sidebar/sidebar.js 的 conversations 数组）
 * 仍然只存在内存里，刷新页面即丢失，真正的「对话持久化」是后续独立 Step 的任务，
 * 不在本文件范围内。本文件只负责「背景图这一类数据」的存取能力，
 * 使用方按自己的 key（目前是会话 id）存取，id 本身是否会在刷新后失效，
 * 取决于上游会话数据是否持久化——这一点在 conversation-backgrounds.js 里会说明。
 *
 * 浏览器兼容性：IndexedDB 在 Chrome / Edge / Safari（含 iOS Safari）均支持，
 * 不需要额外的 polyfill；若浏览器完全不支持或用户关闭了该能力（极少数隐私模式），
 * 所有方法都会走 Promise reject，调用方需要自行 catch 并优雅降级。
 * ============================================================
 */

(function () {
  "use strict";

  var DB_NAME = (window.DSConfig && window.DSConfig.indexedDbName) || "ds_chat_clone_db";
  var DB_VERSION = (window.DSConfig && window.DSConfig.indexedDbVersion) || 1;
  var STORE_NAME = "kv_blobs"; // 通用键值存储：key 为字符串，value 可以是任意可结构化克隆的数据（含 Blob）

  var dbPromise = null;

  /**
   * 打开（或首次创建）数据库，返回同一个 Promise<IDBDatabase>，后续调用复用，
   * 避免每次读写都重新走一遍 onupgradeneeded 流程。
   */
  function openDb() {
    if (dbPromise) {
      return dbPromise;
    }
    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error("当前浏览器不支持 IndexedDB"));
        return;
      }
      var request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error || new Error("打开 IndexedDB 失败"));
      };
    });
    return dbPromise;
  }

  /**
   * 写入一条键值记录（整体覆盖）。
   * @param {string} key
   * @param {*} value 任意可结构化克隆的数据，包含 Blob / File
   * @returns {Promise<void>}
   */
  function put(key, value) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(value, key);
        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          reject(tx.error || new Error("IndexedDB 写入失败"));
        };
      });
    });
  }

  /**
   * 读取一条记录，不存在时 resolve(undefined)（不算错误）。
   * @param {string} key
   * @returns {Promise<*>}
   */
  function get(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, "readonly");
        var request = tx.objectStore(STORE_NAME).get(key);
        request.onsuccess = function () {
          resolve(request.result);
        };
        request.onerror = function () {
          reject(request.error || new Error("IndexedDB 读取失败"));
        };
      });
    });
  }

  /**
   * 删除一条记录。
   * @param {string} key
   * @returns {Promise<void>}
   */
  function remove(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(key);
        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          reject(tx.error || new Error("IndexedDB 删除失败"));
        };
      });
    });
  }

  window.DSDb = {
    put: put,
    get: get,
    remove: remove
  };
})();
