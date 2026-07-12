"""
Layer Operations Utilities

Helper functions for layer geometry, overlap detection, z-index
validation, and layout suggestions.
"""

from agent.models import BoundingBox, CanvasSize, Layer


def compute_layer_bbox(layer: Layer, canvas_size: CanvasSize) -> BoundingBox:
    """Return the layer's bbox, defaulting to full canvas if not set."""
    bbox = layer.bbox
    if bbox.width <= 0 or bbox.height <= 0:
        return BoundingBox(x=0, y=0, width=canvas_size.width, height=canvas_size.height)
    return bbox


def check_layer_overlap(layer_a: Layer, layer_b: Layer) -> bool:
    """Check if two layers' bounding boxes overlap."""
    ba = layer_a.bbox
    bb = layer_b.bbox

    # No overlap if one is entirely to the left/right/above/below the other
    if ba.x + ba.width <= bb.x or bb.x + bb.width <= ba.x:
        return False
    if ba.y + ba.height <= bb.y or bb.y + bb.height <= ba.y:
        return False
    return True


def validate_z_indices(layers: list[Layer]) -> bool:
    """Check that all layers have unique z-indices."""
    z_indices = [l.z_index for l in layers]
    return len(z_indices) == len(set(z_indices))


def suggest_layout(
    image_types: list[str],
    canvas_size: CanvasSize,
) -> list[BoundingBox]:
    """Suggest bounding box layouts for a set of image types.

    Simple rule-based layout: grid arrangement for multiple images.
    """
    count = len(image_types)
    if count == 0:
        return []

    if count == 1:
        # Single image: centered, 80% of canvas
        margin = 0.1
        return [
            BoundingBox(
                x=canvas_size.width * margin,
                y=canvas_size.height * margin,
                width=canvas_size.width * (1 - 2 * margin),
                height=canvas_size.height * (1 - 2 * margin),
            )
        ]

    # Multi-image: simple grid
    cols = min(count, 3)
    rows = (count + cols - 1) // cols
    cell_w = canvas_size.width / cols
    cell_h = canvas_size.height / rows
    padding = 0.05

    boxes = []
    for i in range(count):
        col = i % cols
        row = i // cols
        boxes.append(
            BoundingBox(
                x=col * cell_w + cell_w * padding,
                y=row * cell_h + cell_h * padding,
                width=cell_w * (1 - 2 * padding),
                height=cell_h * (1 - 2 * padding),
            )
        )
    return boxes