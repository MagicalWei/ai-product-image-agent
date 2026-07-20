// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Sidebar from '../../frontend/src/components/Sidebar';
import LayersOutlinePanel from '../../frontend/src/components/LayersOutlinePanel';
import ProductAnalysisCard from '../../frontend/src/components/ProductAnalysisCard';
import Portal from '../../frontend/src/components/Portal';

describe('Sidebar Component', () => {
  const defaultProps = {
    activeView: 'portal',
    onViewChange: vi.fn(),
    isCollapsed: false,
    onToggleCollapse: vi.fn(),
    hasActiveSession: true,
    onHelpDesign: vi.fn()
  };

  it('renders Sidebar menu items correctly when expanded', () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByText('AI Studio')).toBeDefined();
    expect(screen.getByText('首页')).toBeDefined();
    expect(screen.getByText('工具')).toBeDefined();
    expect(screen.getByText('仓库')).toBeDefined();
    expect(screen.getByText('资产库')).toBeDefined();
  });

  it('triggers onViewChange callback when clicking nav items', () => {
    render(<Sidebar {...defaultProps} />);
    const toolsBtn = screen.getByText('工具').closest('button');
    fireEvent.click(toolsBtn);
    expect(defaultProps.onViewChange).toHaveBeenCalledWith('tools');
  });

  it('triggers onToggleCollapse when collapse button clicked', () => {
    render(<Sidebar {...defaultProps} />);
    const collapseBtn = screen.getByTitle('折叠侧边栏');
    fireEvent.click(collapseBtn);
    expect(defaultProps.onToggleCollapse).toHaveBeenCalled();
  });
});

describe('LayersOutlinePanel Component', () => {
  const mockVersion = {
    image: 'bg_sunset.png',
    productCutout: 'cutout.png',
    adText: {
      title: '主图标题文本',
      desc: '副标题文本',
      tag: '促销爆款'
    }
  };

  const defaultProps = {
    currentVersion: mockVersion,
    onInsertRef: vi.fn(),
    onClose: vi.fn()
  };

  it('does not render when currentVersion is null', () => {
    const { container } = render(<LayersOutlinePanel {...defaultProps} currentVersion={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders all layer types based on current version data', () => {
    render(<LayersOutlinePanel {...defaultProps} />);
    expect(screen.getByText('背景图层')).toBeDefined();
    expect(screen.getByText('商品主体图层')).toBeDefined();
    expect(screen.getByText('主标题文本图层')).toBeDefined();
    expect(screen.getByText('副标题文本图层')).toBeDefined();
    expect(screen.getByText('促销标签图层')).toBeDefined();
  });

  it('triggers onInsertRef when quoting a layer', () => {
    render(<LayersOutlinePanel {...defaultProps} />);
    const quoteButtons = screen.getAllByTitle(/引用此图层/);
    expect(quoteButtons.length).toBeGreaterThan(0);
    fireEvent.click(quoteButtons[0]);
    expect(defaultProps.onInsertRef).toHaveBeenCalled();
  });

  it('collapses body when header is clicked', () => {
    render(<LayersOutlinePanel {...defaultProps} />);
    const header = screen.getByText('图层大纲').closest('.layers-panel-header');
    fireEvent.click(header);
    
    expect(screen.queryByText('背景图层')).toBeNull();
  });
});

describe('ProductAnalysisCard MVP', () => {
  const analysis = {
    schema_version: '1.0',
    status: 'draft',
    product: { product_name: '便携榨汁杯', product_category: '小家电', confidence: 0.9 },
    visible_facts: ['透明杯体', '杯型一体化结构'],
    selling_points: [
      { title: '便携设计', description: '杯型结构', visual_evidence: '紧凑杯身', confidence: 0.8, verification: 'confirmed_visual' },
      { title: '方便观察', description: '透明杯体', visual_evidence: '杯体透明可见', confidence: 0.9, verification: 'confirmed_visual' },
      { title: '一体化使用', description: '底座与杯身连接', visual_evidence: '底部集成结构', confidence: 0.7, verification: 'likely_visual' },
    ],
    uncertain_claims: ['无法判断电池容量'],
    image_quality: { subject_complete: true, clarity: 'good', issues: [] },
  };

  it('does not promote analysis until the user confirms selected selling points', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<ProductAnalysisCard analysis={analysis} onConfirm={onConfirm} />);

    expect(screen.getByText(/确认前，这些内容不会进入 Agent 记忆/)).toBeDefined();
    fireEvent.click(screen.getAllByLabelText('取消该卖点')[0]);
    fireEvent.click(screen.getByRole('button', { name: /确认商品信息（2 条卖点）/ }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0].status).toBe('confirmed');
    expect(onConfirm.mock.calls[0][0].selling_points).toHaveLength(2);
  });
});

describe('Portal product upload', () => {
  it('keeps the selected product image attached and sends it with the instruction', async () => {
    const onDirectAgentStart = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <Portal
        onQuickToolClick={vi.fn()}
        onDirectAgentStart={onDirectAgentStart}
      />
    );

    const input = container.querySelector('input[type="file"][accept="image/*"]');
    const file = new File(['product'], 'product.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText('product.png')).toBeDefined());
    expect(onDirectAgentStart).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('textbox', { name: '描述商品设计需求' }), {
      target: { value: '分析商品并生成一张主图' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }));

    await waitFor(() => expect(onDirectAgentStart).toHaveBeenCalledTimes(1));
    expect(onDirectAgentStart.mock.calls[0][0]).toBe('分析商品并生成一张主图');
    expect(onDirectAgentStart.mock.calls[0][2].productImages[0].name).toBe('product.png');
  });
});
