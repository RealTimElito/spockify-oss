FROM python:3.11-slim-bookworm

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

ENV COMFYUI_BACKEND_URL=http://comfyui-backend.spockify.svc.cluster.local:8188 \
    COMFYUI_DEPLOYMENT=comfyui \
    COMFYUI_NAMESPACE=spockify \
    COMFYUI_WAKE_TIMEOUT_S=600 \
    COMFYUI_IDLE_SCALE_DOWN_MINUTES=15

EXPOSE 8188
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8188"]
