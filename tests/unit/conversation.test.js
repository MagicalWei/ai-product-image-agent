import { describe, expect, it } from 'vitest';
import { appendConversationTurns, mergeConversationHistory, recoverConversationHistory } from '../../backend/utils/conversation.js';


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
});
