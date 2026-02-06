#!/bin/bash
# spark-convert-docker.sh
# TranslateGemma-4B conversion using Docker with Python 3.11 + CUDA
# Run in tmux for persistence

set -e

MODEL_ID="google/translategemma-4b-it"
OUTPUT_DIR="$HOME/translategemma-4b-onnx"
LOG_FILE="$HOME/translategemma-conversion.log"
HF_CACHE="$HOME/.cache/huggingface"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Initialize log
echo "" > "$LOG_FILE"
log "=========================================="
log "TranslateGemma-4B Conversion (Docker)"
log "=========================================="
log "Model: $MODEL_ID"
log "Output: $OUTPUT_DIR"

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Check NVIDIA GPU access
log ""
log "Checking GPU access..."
nvidia-smi --query-gpu=name,memory.total --format=csv 2>&1 | tee -a "$LOG_FILE"

# Check HuggingFace token
if [ ! -f "$HF_CACHE/token" ]; then
    log "ERROR: No HuggingFace token found at $HF_CACHE/token"
    log "Run: huggingface-cli login"
    exit 1
fi
log "HuggingFace token found"

# Run conversion in Docker container
log ""
log "Starting Docker container with Python 3.11 + CUDA..."
log "This will take ~40-60 minutes"
log ""

docker run --rm \
    --gpus all \
    -v "$OUTPUT_DIR:/output" \
    -v "$HF_CACHE:/root/.cache/huggingface" \
    -e HF_HOME=/root/.cache/huggingface \
    -e TRANSFORMERS_CACHE=/root/.cache/huggingface/hub \
    pytorch/pytorch:2.6.0-cuda12.6-cudnn9-runtime \
    bash -c '
set -e

echo "[Docker] Installing dependencies..."
pip install --quiet transformers optimum onnx onnxruntime-gpu accelerate
pip install --quiet onnxconverter-common huggingface_hub

echo "[Docker] Cloning Transformers.js..."
cd /tmp
git clone --depth 1 https://github.com/xenova/transformers.js
cd transformers.js
pip install --quiet -e ".[dev]"

echo "[Docker] Testing model access..."
python -c "
from transformers import AutoProcessor
processor = AutoProcessor.from_pretrained(\"google/translategemma-4b-it\", trust_remote_code=True)
print(\"Model access confirmed!\")
"

echo "[Docker] Starting ONNX conversion..."
echo "[Docker] This takes ~30-40 minutes..."
START=$(date +%s)

python -m scripts.convert \
    --model_id google/translategemma-4b-it \
    --output_parent_dir /output \
    --task image-text-to-text \
    --trust_remote_code \
    --device cuda \
    --quantize \
    -- --modes fp16 q4

END=$(date +%s)
DURATION=$((END - START))
echo "[Docker] Conversion completed in $((DURATION / 60)) minutes"

echo "[Docker] Output contents:"
ls -lah /output/

if [ -d "/output/onnx" ]; then
    echo "[Docker] ONNX files:"
    ls -lah /output/onnx/
fi

echo "[Docker] Done!"
' 2>&1 | tee -a "$LOG_FILE"

# Verify output
log ""
log "=========================================="
log "CONVERSION COMPLETE!"
log "=========================================="
log "Output: $OUTPUT_DIR"

log ""
log "Output contents:"
ls -lah "$OUTPUT_DIR" 2>&1 | tee -a "$LOG_FILE"

TOTAL_SIZE=$(du -sh "$OUTPUT_DIR" | cut -f1)
log "Total size: $TOTAL_SIZE"

log ""
log "Next: Upload to HuggingFace with:"
log "  huggingface-cli upload m1cc0z/translategemma-4b-onnx $OUTPUT_DIR"

echo ""
echo "Done! Check log at: $LOG_FILE"
