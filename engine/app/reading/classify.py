"""Stage 3a: one cheap call per Frame — which accepted document is this, or none.

The classifier decides only what is NOT read (app/triage.py); its positive labels never
choose a schema. It sees a thumbnail (config.CLASSIFY_THUMB_DIM): the question is shape
and colour, not text, and a 512 px image is ~280 tokens on Anthropic (measured 283 with
count_tokens) and 1-2 s of image encoding on Ollama. A frame the local detector labelled "sefach" skips the call: the
sefach — a pale sheet with a grid — is the one document a thumbnail can mistake for a
form, and the geometric label is already reliable for it. A detector-labelled cheque
back is the other exception, decided in the pipeline from the page's other frames
(triage.cheque_back_inherits), not here. A failed call is a failed request, like any
other model call; nothing is read blind."""

from .. import config
from ..cropping import Frame
from ..imaging import encode_jpeg
from ..schemas import FrameClass
from . import current_options
from .backend_anthropic import _anthropic_parse
from .backend_ollama import _ollama_json
from .prompts import CLASSIFY_PROMPT, CLASSIFY_SYSTEM_PROMPT


async def classify_frame(frame: Frame) -> FrameClass:
    """The frame's kind (one of doctypes.FRAME_KINDS) and whether the model is sure of it."""
    if frame.label == "sefach":
        return FrameClass(kind="sefach", sure=True)
    opts = current_options()
    image_b64 = encode_jpeg(frame.image, config.CLASSIFY_THUMB_DIM)  # no min_dim: never upscale
    if opts.backend == "anthropic":
        answer = await _anthropic_parse(
            image_b64, CLASSIFY_SYSTEM_PROMPT, CLASSIFY_PROMPT, FrameClass,
            model=opts.classifier_model, max_tokens=config.CLASSIFY_MAX_TOKENS_ANTHROPIC,
            effort=config.CLASSIFY_EFFORT or None,
        )
    else:
        answer = await _ollama_json(
            image_b64, CLASSIFY_SYSTEM_PROMPT, CLASSIFY_PROMPT, FrameClass, config.CLASSIFY_MAX_TOKENS,
            model=opts.classifier_model,
        )
    return answer
