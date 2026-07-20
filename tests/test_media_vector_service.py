import pytest

from agent.media.service import MediaVectorService, build_media_segments


class FakeEmbeddingService:
    async def embed(self, texts):
        return [[float(index), 0.0, 1.0] for index, _ in enumerate(texts)]

    async def embed_query(self, text):
        return [0.5, 0.0, 1.0]


class FakeRepository:
    def __init__(self):
        self.statuses = []
        self.replaced = None
        self.search_args = None

    async def mark_status(self, uid, asset_id, status, error=""):
        self.statuses.append((uid, asset_id, status, error))

    async def replace_segments(self, **kwargs):
        self.replaced = kwargs

    async def search(self, **kwargs):
        self.search_args = kwargs
        return []


def test_image_analysis_becomes_content_style_and_product_text():
    segments = build_media_segments({
        "product": {"product_name": "蓝牙耳机", "product_category": "数码"},
        "visible_facts": ["白色耳机位于充电盒中"],
        "selling_points": [{"title": "小巧", "description": "便于携带"}],
        "visual_style": {
            "style_summary": "极简科技风",
            "lighting": "柔和侧光",
            "color_palette": ["白色", "浅灰"],
        },
    }, media_type="image")

    assert len(segments) == 1
    assert "蓝牙耳机" in segments[0]["content_text"]
    assert "极简科技风" in segments[0]["style_text"]
    assert "数码" in segments[0]["product_text"]


def test_video_analysis_is_split_by_source_and_timestamp():
    segments = build_media_segments({
        "product": "手机",
        "selling_points": ["轻薄"],
        "scenes": [
            {"source_index": 0, "start": 0, "end": 2, "description": "手机正面"},
            {"source_index": 1, "start": 3, "end": 5, "description": "手机背面"},
        ],
    }, media_type="video", source_index=1)

    assert len(segments) == 1
    assert segments[0]["start_time"] == 3
    assert segments[0]["end_time"] == 5
    assert "手机背面" in segments[0]["content_text"]


@pytest.mark.asyncio
async def test_indexing_keeps_account_scope_and_assigns_three_vectors_per_segment():
    repository = FakeRepository()
    service = MediaVectorService(repository, FakeEmbeddingService())

    count = await service.index_analysis(
        uid="user-a",
        asset_id="asset-a",
        session_id="session-a",
        media_type="image",
        analysis={"product": {"product_name": "水杯"}, "visible_facts": ["透明杯身"]},
    )

    assert count == 1
    assert repository.replaced["uid"] == "user-a"
    segment = repository.replaced["segments"][0]
    assert segment["content_embedding"] == [0.0, 0.0, 1.0]
    assert segment["style_embedding"] == [1.0, 0.0, 1.0]
    assert segment["product_embedding"] == [2.0, 0.0, 1.0]
    assert repository.statuses[0][2] == "indexing"


@pytest.mark.asyncio
async def test_search_always_passes_authenticated_account_to_repository():
    repository = FakeRepository()
    service = MediaVectorService(repository, FakeEmbeddingService())
    await service.search(uid="user-b", query="自然光产品图", vector_kind="style")
    assert repository.search_args["uid"] == "user-b"
    assert repository.search_args["vector_kind"] == "style"
