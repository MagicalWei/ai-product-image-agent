"""
知识库管理模块 — 加载 + 分块 + 批量入库

从 rag/knowledge/ 目录加载 Markdown 文件，
分块后通过 EmbeddingService 向量化，批量写入 pgvector。
"""

import os
import re
import json
import logging
from pathlib import Path
from typing import List, Optional

from .models import RagDocument, KnowledgeChunk
from .embeddings import EmbeddingService
from .vector_store import VectorStore

logger = logging.getLogger(__name__)

# 知识库 Markdown 文件目录
KNOWLEDGE_DIR = Path(__file__).parent / "knowledge"

# 分块参数
DEFAULT_CHUNK_SIZE = 800   # 每块最大字符数
DEFAULT_CHUNK_OVERLAP = 100  # 块间重叠字符数

# 查询重写提示词（供 retrieval 模块引用）
QUERY_REWRITE_PROMPT = (
    "你是一个电商商品图领域的查询优化助手。"
    "将用户的模糊查询改写为更适合向量检索的精确查询。"
)

# 分类标签映射
CATEGORY_META = {
    "prompt_template": {
        "name": "Prompt 模板库",
        "description": "各类图片类型的优质 prompt 模板",
    },
    "style_guide": {
        "name": "风格指南",
        "description": "不同电商平台的视觉风格规范",
    },
    "platform_rule": {
        "name": "平台规则",
        "description": "各平台图片尺寸、格式、内容审核要求",
    },
    "copywriting": {
        "name": "文案模板",
        "description": "电商文案写作模板和卖点提炼技巧",
    },
}


class KnowledgeBase:
    """商品图知识库管理

    用法:
        kb = KnowledgeBase(vector_store, embedding_service)
        await kb.load_and_index()  # 加载 knowledge/ 目录下所有 .md 并入库
        count = await kb.get_document_count()
    """

    def __init__(
        self,
        vector_store: VectorStore,
        embedding_service: EmbeddingService,
        knowledge_dir: Optional[Path] = None,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
        chunk_overlap: int = DEFAULT_CHUNK_OVERLAP,
    ):
        self.vector_store = vector_store
        self.embedding_service = embedding_service
        self.knowledge_dir = knowledge_dir or KNOWLEDGE_DIR
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def _determine_category(self, file_path: Path) -> str:
        """根据文件路径判断分类"""
        path_str = str(file_path).lower()
        for cat in CATEGORY_META:
            if cat in path_str:
                return cat
        # 从文件名推断
        filename = file_path.stem.lower()
        if "prompt" in filename or "template" in filename:
            return "prompt_template"
        if "style" in filename or "guide" in filename:
            return "style_guide"
        if "platform" in filename or "rule" in filename:
            return "platform_rule"
        if "copy" in filename or "writing" in filename:
            return "copywriting"
        return "general"

    def load_markdown_files(self) -> List[KnowledgeChunk]:
        """加载 knowledge/ 目录下所有 Markdown 文件并分块

        Returns:
            分块后的知识块列表
        """
        if not self.knowledge_dir.exists():
            logger.warning(f"Knowledge directory not found: {self.knowledge_dir}")
            return []

        chunks: List[KnowledgeChunk] = []
        md_files = sorted(self.knowledge_dir.rglob("*.md"))

        if not md_files:
            logger.warning(f"No .md files found in {self.knowledge_dir}")
            return []

        for md_file in md_files:
            try:
                with open(md_file, "r", encoding="utf-8") as f:
                    content = f.read()

                if not content.strip():
                    continue

                category = self._determine_category(md_file)

                # 按 Markdown 标题分块
                file_chunks = self._split_by_headers(
                    content=content,
                    source=str(md_file.relative_to(self.knowledge_dir)),
                    category=category,
                )
                chunks.extend(file_chunks)
                logger.info(
                    f"Loaded {md_file.name}: {len(file_chunks)} chunks, category={category}"
                )

            except Exception as e:
                logger.error(f"Failed to load {md_file}: {e}")

        logger.info(f"Total loaded: {len(chunks)} chunks from {len(md_files)} files")
        return chunks

    def _split_by_headers(
        self, content: str, source: str, category: str
    ) -> List[KnowledgeChunk]:
        """按 Markdown 标题（## 和 #）分块

        对过长的段落（> chunk_size）进一步滑动窗口分割。
        """
        chunks: List[KnowledgeChunk] = []

        # 按 ## 标题分割
        sections = re.split(r"\n(?=## )", content)

        for section in sections:
            section = section.strip()
            if not section:
                continue

            # 提取标题作为元数据
            title_match = re.match(r"^#+\s*(.+)", section)
            title = title_match.group(1).strip() if title_match else ""

            if len(section) <= self.chunk_size:
                chunks.append(KnowledgeChunk(
                    content=section,
                    metadata={
                        "source": source,
                        "title": title,
                        "category": category,
                        "category_name": CATEGORY_META.get(category, {}).get("name", ""),
                    },
                    category=category,
                ))
            else:
                # 段落过长，滑动窗口分割
                sub_chunks = self._sliding_window_split(section)
                for i, sub in enumerate(sub_chunks):
                    chunks.append(KnowledgeChunk(
                        content=sub,
                        metadata={
                            "source": source,
                            "title": f"{title} (part {i+1})" if title else f"part {i+1}",
                            "category": category,
                            "category_name": CATEGORY_META.get(category, {}).get("name", ""),
                            "chunk_index": i,
                        },
                        category=category,
                    ))

        return chunks

    def _sliding_window_split(self, text: str) -> List[str]:
        """滑动窗口分割长文本"""
        if len(text) <= self.chunk_size:
            return [text]

        chunks = []
        start = 0
        while start < len(text):
            end = start + self.chunk_size
            chunk_text = text[start:end]
            chunks.append(chunk_text)
            start += (self.chunk_size - self.chunk_overlap)

        return chunks

    async def load_and_index(self, force_reindex: bool = False) -> int:
        """加载知识库文件并批量入库

        Args:
            force_reindex: 是否先清空现有数据再重新索引

        Returns:
            入库的文档数量
        """
        chunks = self.load_markdown_files()
        if not chunks:
            logger.warning("No chunks to index")
            return 0

        # 可选：清空重建
        if force_reindex:
            for cat in CATEGORY_META:
                await self.vector_store.delete_by_category(cat)
            logger.info("Cleared existing RAG documents for full reindex")

        # 批量向量化
        texts = [c.content for c in chunks]
        logger.info(f"Generating embeddings for {len(texts)} chunks...")
        embeddings = await self.embedding_service.embed(texts)
        logger.info(f"Generated {len(embeddings)} embeddings")

        # 构建 RagDocument 列表
        docs: List[RagDocument] = []
        for chunk, emb in zip(chunks, embeddings):
            docs.append(RagDocument(
                content=chunk.content,
                metadata=chunk.metadata,
                embedding=emb,
                category=chunk.category,
            ))

        # 批量入库
        ids = await self.vector_store.insert_batch(docs)
        logger.info(f"Indexed {len(ids)} documents into pgvector")
        return len(ids)

    async def get_document_count(self) -> int:
        """获取知识库文档总数"""
        return await self.vector_store.count()

    async def get_category_stats(self) -> dict:
        """获取各分类的文档统计"""
        stats = {}
        for cat in CATEGORY_META:
            count = await self.vector_store.count(category=cat)
            stats[cat] = {
                "name": CATEGORY_META[cat]["name"],
                "count": count,
            }
        total = await self.vector_store.count()
        stats["_total"] = {"name": "总计", "count": total}
        return stats

    @classmethod
    def get_supported_categories(cls) -> List[str]:
        """获取支持的分类列表"""
        return list(CATEGORY_META.keys())
