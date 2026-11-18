/**
 * ============================================================
 * mock-data.js —— 侧边栏对话列表假数据（Step 2 专用）
 * ============================================================
 * 【重要】本文件仅用于 Step 2 阶段的前端 UI 验证，提供假的对话列表数据，
 * 不连接 IndexedDB、不做真实持久化。后续 Step（本地数据持久化）接入后，
 * 真实数据将改为从 storage 模块异步读取，本文件可以被整体移除或仅保留
 * 作为「无历史数据时的演示数据」选项。
 *
 * 数据结构说明（与后续真实存储的对话对象结构保持一致，方便无缝切换）：
 * {
 *   id: string,            // 对话唯一 ID
 *   title: string,         // 对话标题
 *   preview: string,       // 最后一条消息预览文本
 *   updatedAt: number,     // 最后更新时间（毫秒时间戳），列表按此字段倒序排列
 *   pinned: boolean,       // 是否置顶
 *   messages: []           // Step 2 不涉及消息内容，先留空数组占位
 * }
 * ============================================================
 */

(function () {
  "use strict";

  // 以当前时间为基准，构造若干条不同时间间隔的假数据，模拟「刚刚/几分钟前/几天前」的真实分布
  var now = Date.now();
  var MINUTE = 60 * 1000;
  var HOUR = 60 * MINUTE;
  var DAY = 24 * HOUR;

  var MOCK_CONVERSATIONS = [
    {
      id: "mock-1",
      title: "关于奇幻小说世界观设定的讨论",
      preview: "好的，那么魔法体系就按「元素亲和度」来划分等级……",
      updatedAt: now - 5 * MINUTE,
      pinned: true,
      // 该对话预置了几条演示消息，用于验证“切换对话后聊天区加载对应历史消息”的效果，
      // 其余假对话保持空消息数组，切换过去会展示空状态欢迎页。
      messages: [
        {
          id: "mock-1-msg-1",
          role: "user",
          content: "我想写一部奇幻小说，帮我设计一下魔法体系，要有等级区分。",
          createdAt: now - 20 * MINUTE
        },
        {
          id: "mock-1-msg-2",
          role: "assistant",
          thinking:
            "用户需要一个有等级区分的魔法体系。常见思路有：元素系、法力值等级、血脉天赋等。\n" +
            "为了兼顾设定深度与可扩展性，采用“元素亲和度”作为核心变量，再叠加等级制度，\n" +
            "这样既有成长线，也方便后续扩展不同元素之间的克制关系。",
          content:
            "可以按照**元素亲和度**来设计：\n\n" +
            "- **初阶（1-3 级）**：只能感知并微弱操控单一元素\n" +
            "- **中阶（4-6 级）**：可以稳定施放元素法术，开始理解元素间的克制关系\n" +
            "- **高阶（7-9 级）**：能够融合两种元素，创造复合法术\n" +
            "- **大师（10 级+）**：突破元素束缚，达到“域”级别的空间掌控\n\n" +
            "好的，那么魔法体系就按「元素亲和度」来划分等级，你觉得这个方向合适吗？",
          createdAt: now - 19 * MINUTE
        },
        {
          id: "mock-1-msg-3",
          role: "user",
          content: "很好，那主角的血脉设定呢？",
          createdAt: now - 6 * MINUTE
        }
      ]
    },
    {
      id: "mock-2",
      title: "帮我写一份周报总结",
      preview: "本周完成了三项主要工作：第一，接口适配层的设计评审……",
      updatedAt: now - 2 * HOUR,
      pinned: false,
      messages: []
    },
    {
      id: "mock-3",
      title: "角色扮演：赛博朋克酒馆老板",
      preview: "（擦拭着杯子）欢迎来到夜之城，陌生人，想喝点什么？",
      updatedAt: now - 1 * DAY,
      pinned: false,
      messages: []
    },
    {
      id: "mock-4",
      title: "Python 列表推导式用法示例",
      preview: "可以这样写：[x*x for x in range(10) if x % 2 == 0]",
      updatedAt: now - 2 * DAY,
      pinned: false,
      messages: []
    },
    {
      id: "mock-5",
      title: "旅行计划：三天两夜周边游",
      preview: "第一天上午建议先去古镇逛逛，下午安排……",
      updatedAt: now - 6 * DAY,
      pinned: false,
      messages: []
    },
    {
      id: "mock-6",
      title: "新对话",
      preview: "（这是一条很长很长很长很长很长很长很长的消息预览，用于测试超出宽度后的省略号效果）",
      updatedAt: now - 12 * DAY,
      pinned: false,
      messages: []
    }
  ];

  // 深拷贝导出，避免外部直接修改到原始数组引用导致数据被污染
  function getMockConversations() {
    return JSON.parse(JSON.stringify(MOCK_CONVERSATIONS));
  }

  window.DSMockData = {
    getMockConversations: getMockConversations
  };
})();
