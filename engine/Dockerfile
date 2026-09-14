FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv

COPY requirements.txt .
# rapidocr-onnxruntime installed separately, --no-deps: it declares opencv-python and
# this engine deliberately uses opencv-python-headless (see requirements.txt).
RUN pip install --no-cache-dir -r requirements.txt \
 && pip install --no-cache-dir --no-deps rapidocr-onnxruntime==1.2.3

COPY app ./app

# Uploads are never stored: Starlette keeps a part up to 1 MB in memory and spools a larger one
# to a temporary file deleted when the request ends (the Privacy Policy states this).
RUN useradd --system --uid 10001 --no-create-home makor
USER makor

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=3).status == 200 else 1)"

# --proxy-headers: trust X-Forwarded-* from the web app / Caddy so client IPs land in the access log
# (paths only — uvicorn never logs bodies). Single worker: the admission gate is
# per-process, several workers would each keep their own queue in front of one Ollama.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
