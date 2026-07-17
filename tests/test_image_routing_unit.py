import unittest

from agent.image_routing import (
    build_seedream_edit_prompt,
    is_attachment_receipt_question,
    parse_direct_image_request,
)
from agent.multi_agent.agents.image_generator import ImageGeneratorAgent
from agent.multi_agent.orchestrator import MultiAgentOrchestrator
from agent.multi_agent.shared_context import AgentMessage, AgentRole, SharedContext
from backend.agent_service.memory import AgentMemory


class ImageRoutingTests(unittest.TestCase):
    def test_any_composer_attachment_marker_routes_directly(self):
        direct, region, prompt = parse_direct_image_request(
            "[[DIRECT_IMAGE_AGENT]]\n生成一个蓝色背景"
        )
        self.assertTrue(direct)
        self.assertFalse(region)
        self.assertEqual(prompt, "生成一个蓝色背景")

    def test_region_marker_adds_frame_invariants(self):
        direct, region, prompt = parse_direct_image_request(
            "[[DIRECT_IMAGE_AGENT_REGION]]\n把框内瓶盖改成红色"
        )
        self.assertTrue(direct)
        self.assertTrue(region)
        expanded = build_seedream_edit_prompt(prompt, region_edit=region)
        self.assertIn("只修改矩形框内", expanded)
        self.assertIn("框外", expanded)
        self.assertIn("移除彩色矩形框", expanded)

    def test_internal_attachment_context_is_removed_from_user_prompt(self):
        direct, region, prompt = parse_direct_image_request(
            "[[DIRECT_IMAGE_AGENT_REGION]]\n[系统] 已附加框选图\n[用户指令]\n修改字体"
        )
        self.assertTrue(direct)
        self.assertTrue(region)
        self.assertEqual(prompt, "修改字体")

    def test_attachment_receipt_question_is_detected(self):
        self.assertTrue(is_attachment_receipt_question("看到我发你的图片了吗"))
        self.assertFalse(is_attachment_receipt_question("把图片里的字体改一下"))

    def test_force_image_agent_always_uses_attachment(self):
        agent = ImageGeneratorAgent({}, {})
        ctx = SharedContext(
            session_id="test",
            user_message="优化图片",
            reference_images=["data:image/png;base64,dGVzdA=="],
            metadata={"_force_image_agent": True},
        )
        self.assertEqual(agent._select_generation_references(ctx), ctx.reference_images)


class _FakeImageGenerator:
    role = AgentRole.IMAGE_GENERATOR

    async def execute(self, ctx):
        ctx.generated_images["edit"] = "https://example.test/edited.png"
        return AgentMessage(
            role=self.role,
            action="generate_images",
            content="generated",
            success=True,
        )


class MultiAgentDirectRoutingTests(unittest.IsolatedAsyncioTestCase):
    async def test_attachment_skips_requirement_agents(self):
        orchestrator = MultiAgentOrchestrator(
            chat_config={},
            image_config={},
        )
        orchestrator._agents["image_generator"] = _FakeImageGenerator()
        events = []
        async for event in orchestrator.run(
            message="[[DIRECT_IMAGE_AGENT_REGION]]\n把框内改成蓝色",
            memory=AgentMemory(),
            product_image_base64="data:image/png;base64,dGVzdA==",
            reference_images=["data:image/png;base64,dGVzdA=="],
        ):
            events.append(event)

        phases = [event.get("phase") for event in events if event.get("event") == "agent_thinking"]
        self.assertEqual(phases, ["image_generator"])
        self.assertTrue(any(event.get("event") == "image_progress" for event in events))
        self.assertFalse(any(phase == "requirement_collector" for phase in phases))


if __name__ == "__main__":
    unittest.main()
