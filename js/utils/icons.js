/**
 * ============================================================
 * icons.js —— 轻量内联 SVG 图标注入工具
 * ============================================================
 * 设计说明：
 * 需求禁止引入重型图标字体库，这里采用「纯内联 SVG 字符串字典 + 原生 DOM 注入」
 * 的方式实现图标系统，不产生任何网络请求，体积极小。
 * HTML 中只需写 <span class="icon" data-icon="xxx"></span> 占位，
 * 本模块在初始化时会遍历页面上所有带 data-icon 的节点，把对应的 SVG
 * 字符串塞进去。后续任何 Step 动态插入新的 DOM（例如消息列表里的复制按钮），
 * 只需调用 window.DSIcons.render(container) 对新增的局部容器重新渲染一次即可。
 * ============================================================
 */

(function () {
  "use strict";

  // SVG 统一使用 24x24 视窗、currentColor 描边，颜色由外层 CSS color 属性控制，
  // 这样浅色/深色主题切换时图标颜色自动跟随文字色变量，无需额外适配。
  var ICONS = {
    // 新建对话：加号
    plus:
      '<svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    // 搜索：放大镜
    search:
      '<svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4.3-4.3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    // 设置：齿轮
    settings:
      '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 005.09 15a1.65 1.65 0 00-1.51-1H3.5a2 2 0 110-4h.09A1.65 1.65 0 005.09 9a1.65 1.65 0 00-.33-1.82l-.06-.06A2 2 0 017.53 4.3l.06.06A1.65 1.65 0 009.4 4.7a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.3 9c.14.3.22.62.22.95V10a1.65 1.65 0 001.5 1h.1a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" stroke-width="1.5"/></svg>',
    // 清空/删除：垃圾桶
    trash:
      '<svg viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6h16z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    // 汉堡菜单：三横线
    menu:
      '<svg viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    // 收起侧边栏：向左箭头方括号
    collapse:
      '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="2"/><path d="M9 4v16" stroke="currentColor" stroke-width="2"/><path d="M15 9l-2.5 3 2.5 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    // 展开侧边栏：与 collapse 镜像（箭头方向相反）
    expand:
      '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="2"/><path d="M9 4v16" stroke="currentColor" stroke-width="2"/><path d="M13 9l2.5 3-2.5 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    // 压缩上下文：两个箭头向中间收缩
    compress:
      '<svg viewBox="0 0 24 24" fill="none"><path d="M9 4v4a1 1 0 01-1 1H4M15 4v4a1 1 0 001 1h4M9 20v-4a1 1 0 00-1-1H4M15 20v-4a1 1 0 011-1h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    // 滚动到底部：向下箭头
    "arrow-down":
      '<svg viewBox="0 0 24 24" fill="none"><path d="M12 4v16M5 13l7 7 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    // 附件：回形针
    attach:
      '<svg viewBox="0 0 24 24" fill="none"><path d="M21 11.5l-8.49 8.49a4.95 4.95 0 01-7-7l9.19-9.19a3.5 3.5 0 014.95 4.95L11 17.4a2 2 0 01-2.83-2.83l7.07-7.07" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    // 深度思考：灯泡
    thinking:
      '<svg viewBox="0 0 24 24" fill="none"><path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7c.6.5 1 1.2 1 2.3h6c0-1.1.4-1.8 1-2.3A7 7 0 0012 2z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    // 发送：纸飞机
    send:
      '<svg viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    // 停止：实心方块
    stop:
      '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    // 重命名：铅笔
    edit:
      '<svg viewBox="0 0 24 24" fill="none"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    // 置顶：图钉
    pin:
      '<svg viewBox="0 0 24 24" fill="none"><path d="M12 17v5M9 3h6l-1 6 4 4v2H6v-2l4-4-1-6z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    // 取消置顶：带斜线的图钉（复用 pin 并在使用处通过 class 加斜线效果，这里单独给一个简化版本）
    unpin:
      '<svg viewBox="0 0 24 24" fill="none"><path d="M12 17v5M9 3h6l-1 6 4 4v2H6v-2l4-4-1-6z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 3l18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    // 导出：向下箭头加下划线
    export:
      '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3v12M7 10l5 5 5-5M4 19h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    // 导入文件：向上箭头加托盘，与 export 镜像
    upload:
      '<svg viewBox="0 0 24 24" fill="none"><path d="M12 15V3M7 8l5-5 5 5M4 19h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    // 更多操作：三个点
    more:
      '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
    // 复制
    copy:
      '<svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="12" height="12" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1" stroke="currentColor" stroke-width="2"/></svg>',
    // 重新生成：循环箭头
    refresh:
      '<svg viewBox="0 0 24 24" fill="none"><path d="M3 12a9 9 0 0115-6.7L21 8M21 3v5h-5M21 12a9 9 0 01-15 6.7L3 16M3 21v-5h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    // 点赞
    "thumb-up":
      '<svg viewBox="0 0 24 24" fill="none"><path d="M7 11v10H4a1 1 0 01-1-1v-8a1 1 0 011-1h3zm0 0l4.5-8a2 2 0 013.6 1.8L14 9h5a2 2 0 012 2.2l-1.2 7A2 2 0 0117.8 20H9a2 2 0 01-2-2v-7z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    // 点踩（点赞的垂直镜像，复用同形状通过 transform 翻转）
    "thumb-down":
      '<svg viewBox="0 0 24 24" fill="none" style="transform:rotate(180deg)"><path d="M7 11v10H4a1 1 0 01-1-1v-8a1 1 0 011-1h3zm0 0l4.5-8a2 2 0 013.6 1.8L14 9h5a2 2 0 012 2.2l-1.2 7A2 2 0 0117.8 20H9a2 2 0 01-2-2v-7z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    // 关闭：X
    close:
      '<svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    // 分支切换器：左箭头
    "chevron-left":
      '<svg viewBox="0 0 24 24" fill="none"><path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    // 分支切换器：右箭头
    "chevron-right":
      '<svg viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  /**
   * 对指定容器内（默认整个 document）所有带 data-icon 属性的节点注入对应 SVG。
   * 已经注入过的节点会带上 data-icon-rendered 标记，避免重复注入造成性能浪费。
   * @param {ParentNode} [root] 局部容器，默认 document，供动态插入的新 DOM 调用
   */
  function render(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll("[data-icon]:not([data-icon-rendered])");
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var name = node.getAttribute("data-icon");
      if (ICONS[name]) {
        node.innerHTML = ICONS[name];
        node.setAttribute("data-icon-rendered", "1");
      } else {
        // 边界处理：未知图标名，输出告警但不阻断渲染，避免影响整体页面
        console.warn('[DSIcons] 未找到名为 "' + name + '" 的图标定义。');
      }
    }
  }

  // 挂载到全局命名空间
  window.DSIcons = {
    ICONS: ICONS,
    render: render
  };
})();
