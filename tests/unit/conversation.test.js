import { describe, expect, it } from 'vitest';
import { appendConversationTurns, mergeConversationHistory, recoverConversationHistory, toModelConversationHistory } from '../../backend/utils/conversation.js';
import { mergeConversationMessages, toDurableConversationHistory } from '../../frontend/src/lib/conversationCache.js';


describe('appendConversationTurns', () => {
  it('persists the user reply and the actual clarification text', () => {
    const result = appendConversationTurns(
      [{ role: 'assistant', content: '商品信息已确认' }],
      '自然场景，卖点图',
      ['已开始根据商品图生成卖点图。'],
    );

    expect(result.slice(-2)).toEqual([
      { role: 'user', content: '自然场景，卖点图' },
      { role: 'assistant', content: '已开始根据商品图生成卖点图。' },
    ]);
  });

  it('ignores blank stream messages and adjacent duplicates', () => {
    const result = appendConversationTurns([], '生成卖点图', ['', '处理中', '处理中']);
    expect(result).toEqual([
      { role: 'user', content: '生成卖点图' },
      { role: 'assistant', content: '处理中' },
    ]);
  });

  it('recovers legacy recent chat when persisted history is empty', () => {
    expect(recoverConversationHistory([], {
      recent_chat: [
        { role: 'user', content: '进行卖点图生成吧' },
        { role: 'assistant', content: '请确认风格' },
      ],
    })).toEqual([
      { role: 'user', content: '进行卖点图生成吧' },
      { role: 'assistant', content: '请确认风格' },
    ]);
  });

  it('does not truncate a conversation after one hundred messages', () => {
    const existing = Array.from({ length: 120 }, (_, index) => ({ role: 'user', content: `消息 ${index}` }));
    const result = appendConversationTurns(existing, '第 121 条', ['收到']);
    expect(result).toHaveLength(122);
    expect(result[0]).toEqual({ role: 'user', content: '消息 0' });
  });

  it('persists image metadata with the user turn', () => {
    const images = [{ id: 'region-1', url: '/uploads/region.png', kind: 'region_edit' }];
    expect(appendConversationTurns([], '修改字体', [], { images })).toEqual([
      { role: 'user', content: '修改字体', images },
    ]);
  });

  it('persists visible Agent status records without sending them to the model', () => {
    const history = appendConversationTurns([], '生成详情图', [
      {
        role: 'status',
        agent: 'react_agent',
        type: 'agent_status',
        content: '🔧 正在生成你选择的商品图...',
      },
    ]);

    expect(history).toEqual([
      { role: 'user', content: '生成详情图' },
      {
        role: 'status',
        agent: 'react_agent',
        type: 'agent_status',
        content: '🔧 正在生成你选择的商品图...',
      },
    ]);
    expect(toModelConversationHistory(history)).toEqual([
      { role: 'user', content: '生成详情图' },
    ]);
  });

  it('strips rich attachment metadata before calling the strict Agent API', () => {
    expect(toModelConversationHistory([
      {
        role: 'user',
        content: '修改字体',
        images: [{ id: 'region-1', url: '/uploads/region.png' }],
      },
      { role: 'assistant', content: '正在处理', latency_ms: 120 },
    ])).toEqual([
      { role: 'user', content: '修改字体' },
      { role: 'assistant', content: '正在处理' },
    ]);
  });

  it('merges pipeline history without duplicating or dropping existing turns', () => {
    const existing = [
      { role: 'user', content: '第一条' },
      { role: 'assistant', content: '第一条回复' },
    ];
    const incoming = [
      ...existing,
      { role: 'user', content: '第二条' },
    ];
    expect(mergeConversationHistory(existing, incoming)).toEqual(incoming);
    expect(mergeConversationHistory(existing, [{ role: 'user', content: '新设计' }])).toEqual([
      ...existing,
      { role: 'user', content: '新设计' },
    ]);
  });

  it('keeps a UI status between its user turn and the later formal reply', () => {
    const existing = [
      { role: 'user', content: '制作详情页' },
      { role: 'status', content: '🔧 正在生成详情页' },
    ];
    const incoming = [
      { role: 'user', content: '制作详情页' },
      { role: 'assistant', content: '详情页已生成' },
    ];

    expect(mergeConversationHistory(existing, incoming)).toEqual([
      { role: 'user', content: '制作详情页' },
      { role: 'status', content: '🔧 正在生成详情页' },
      { role: 'assistant', content: '详情页已生成' },
    ]);
  });
});

describe('mergeConversationMessages', () => {
  it('keeps a locally sent turn when the server history is stale', () => {
    const server = [{ sender: 'ai', text: '请确认是否需要卖点图' }];
    const local = [...server, { sender: 'user', text: '要的' }];
    expect(mergeConversationMessages(server, local)).toEqual(local);
  });

  it('adds a durable server reply without hiding local content', () => {
    const local = [
      { sender: 'ai', text: '请确认是否需要卖点图' },
      { sender: 'user', text: '要的' },
    ];
    const server = [
      ...local,
      { sender: 'ai', text: '已开始生成' },
    ];
    expect(mergeConversationMessages(server, local)).toEqual(server);
  });

  it('deduplicates the same durable turn when only the local copy has an id', () => {
    const server = [
      { sender: 'user', text: '修改字体' },
      { sender: 'ai', text: '正在处理' },
    ];
    const local = [
      { id: 'user-turn-1', sender: 'user', text: '修改字体' },
      { sender: 'ai', text: '正在处理' },
    ];

    expect(mergeConversationMessages(server, local)).toEqual([
      { id: 'user-turn-1', sender: 'user', text: '修改字体' },
      { sender: 'ai', text: '正在处理' },
    ]);
  });

  it('keeps server chronology and appends only a genuinely unsynced local suffix', () => {
    const server = [
      { sender: 'user', text: '第一条' },
      { sender: 'ai', text: '第一条回复' },
      { sender: 'user', text: '第二条' },
    ];
    const local = [
      { sender: 'user', text: '第一条' },
      { sender: 'user', text: '第二条' },
      { sender: 'user', text: '第三条（未同步）' },
    ];

    expect(mergeConversationMessages(server, local).map(message => message.text)).toEqual([
      '第一条',
      '第一条回复',
      '第二条',
      '第三条（未同步）',
    ]);
  });

  it('preserves repeated messages by occurrence count', () => {
    const server = [
      { sender: 'user', text: '重试' },
      { sender: 'ai', text: '第一次失败' },
    ];
    const local = [
      { sender: 'user', text: '重试' },
      { sender: 'ai', text: '第一次失败' },
      { sender: 'user', text: '重试' },
    ];

    expect(mergeConversationMessages(server, local).map(message => message.text)).toEqual([
      '重试',
      '第一次失败',
      '重试',
    ]);
  });

  it('does not move an earlier tool status behind a later user turn on restore', () => {
    const server = [
      { sender: 'user', text: '为商品制作 A+/详情页' },
      { sender: 'user', text: '生成好了吗' },
      { sender: 'ai', text: '请确认是否需要调整' },
    ];
    const local = [
      { sender: 'user', text: '为商品制作 A+/详情页' },
      { sender: 'ai', agent: 'react_agent', text: '🔧 正在生成你选择的商品图...' },
      { sender: 'user', text: '生成好了吗' },
      { sender: 'ai', text: '请确认是否需要调整' },
    ];

    expect(mergeConversationMessages(server, local)).toEqual(local);
  });

  it('repairs a legacy cache that already appended an earlier status at the end', () => {
    const server = [
      { sender: 'user', text: '为商品制作 A+/详情页' },
      { sender: 'user', text: '生成好了吗' },
      { sender: 'ai', text: '请确认是否需要调整' },
    ];
    const corruptedLocal = [
      ...server,
      { sender: 'ai', agent: 'react_agent', text: '🔧 正在生成你选择的商品图...' },
    ];

    expect(mergeConversationMessages(server, corruptedLocal).map(message => message.text)).toEqual([
      '为商品制作 A+/详情页',
      '🔧 正在生成你选择的商品图...',
      '生成好了吗',
      '请确认是否需要调整',
    ]);
  });

  it('serializes repaired UI statuses and user attachments for cloud backfill', () => {
    expect(toDurableConversationHistory([
      { id: 'turn-1', sender: 'user', text: '制作详情页', images: [{ id: 'image-1', url: '/uploads/1.png' }] },
      { sender: 'ai', agent: 'react_agent', text: '🔧 正在生成你选择的商品图...' },
      { sender: 'ai', type: 'product_analysis', data: { product: {} } },
    ])).toEqual([
      { id: 'turn-1', role: 'user', content: '制作详情页', images: [{ id: 'image-1', url: '/uploads/1.png' }] },
      { role: 'status', content: '🔧 正在生成你选择的商品图...', agent: 'react_agent', type: 'agent_status' },
    ]);
  });

  it('keeps local attachment metadata when the durable text turn matches', () => {
    const localImage = { id: 'region-1', url: '/uploads/region.png', kind: 'region_edit' };
    const merged = mergeConversationMessages(
      [{ sender: 'user', text: '修改框选区域' }],
      [{ id: 'turn-1', sender: 'user', text: '修改框选区域', images: [localImage] }],
    );

    expect(merged).toEqual([
      { id: 'turn-1', sender: 'user', text: '修改框选区域', images: [localImage] },
    ]);
  });

  it('keeps a product analysis card anchored in its original timeline position', () => {
    const analysis = { id: 'local-analysis', sender: 'ai', type: 'product_analysis', data: { product: {} } };
    const local = [
      { sender: 'ai', text: '欢迎' },
      analysis,
      { sender: 'user', text: '修改字体' },
    ];
    const server = [
      { sender: 'ai', text: '欢迎' },
      { sender: 'user', text: '修改字体' },
      { id: 'server-analysis', sender: 'ai', type: 'product_analysis', data: { product: {} } },
      { sender: 'ai', text: '请说明位置' },
    ];

    const merged = mergeConversationMessages(server, local);
    expect(merged.filter(message => message.type === 'product_analysis')).toHaveLength(1);
    expect(merged.map(message => message.type || message.text)).toEqual([
      '欢迎',
      'product_analysis',
      '修改字体',
      '请说明位置',
    ]);
  });
});
