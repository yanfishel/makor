"""Every photometric filter runs on a Frame, never on a Page: regions.py thresholds
saturation, brightness and ink against raw pixel values."""
from PIL import Image

from app.imaging import FILTERS, prepare_frame


def _gradient(width: int = 300, height: int = 200) -> Image.Image:
    image = Image.new("RGB", (width, height))
    image.putdata([(x * 255 // width, x * 255 // width, x * 255 // width)
                   for _ in range(height) for x in range(width)])
    return image


def test_prepare_frame_reports_the_filters_it_ran():
    _, applied = prepare_frame(_gradient())
    assert applied == tuple(name for name, _ in FILTERS)


def test_every_filter_preserves_size_and_mode():
    source = _gradient()
    for name, filter_fn in FILTERS:
        result = filter_fn(source)
        assert result.size == source.size, name
        assert result.mode == source.mode, name


def test_every_filter_returns_a_new_image():
    source = _gradient()
    for name, filter_fn in FILTERS:
        assert filter_fn(source) is not source, name
