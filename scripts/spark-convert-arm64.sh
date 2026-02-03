#!/bin/bash
# spark-convert-arm64.sh
# TranslateGemma-4B conversion for ARM64 DGX Spark
# Uses ARM64-native container with CUDA support

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
log "TranslateGemma-4B Conversion (ARM64)"
log "=========================================="
log "Model: $MODEL_ID"
log "Output: $OUTPUT_DIR"
log "Architecture: $(uname -m)"

# Create output directory
mkdir -p "$OUTPUT_DIR"
rm -rf "$OUTPUT_DIR"/*

# Check GPU
log ""
log "Checking GPU..."
nvidia-smi --query-gpu=name,memory.total --format=csv 2>&1 | tee -a "$LOG_FILE"

# Check HuggingFace token
if [ ! -f "$HF_CACHE/token" ]; then
    log "ERROR: No HuggingFace token found"
    exit 1
fi
log "HuggingFace token found"

# Run conversion
log ""
log "Starting ARM64 container with GPU support..."
log "This will take ~40-60 minutes"
log ""

docker run --rm \
    --runtime=nvidia \
    --gpus all \
    -v "$OUTPUT_DIR:/output" \
    -v "$HF_CACHE:/root/.cache/huggingface" \
    -e HF_HOME=/root/.cache/huggingface \
    -e TRANSFORMERS_CACHE=/root/.cache/huggingface/hub \
    lmsysorg/sglang:v0.5.7-cu130-arm64-runtime \
    bash -c '
set -e

echo "[Container] Python version: $(python3 --version)"
echo "[Container] Architecture: $(uname -m)"

echo ""
echo "[Container] Installing dependencies..."
pip install --quiet --upgrade pip
pip install --quiet transformers optimum onnx onnxruntime accelerate
pip install --quiet onnxconverter-common huggingface_hub

echo ""
echo "[Container] Cloning Transformers.js conversion scripts..."
cd /tmp
git clone --depth 1 https://github.com/xenova/transformers.js

echo ""
echo "[Container] Installing conversion script dependencies..."
pip install --quiet sentencepiece protobuf

echo ""
echo "[Container] Testing model access..."
python3 -c "
from transformers import AutoProcessor
processor = AutoProcessor.from_pretrained(\"google/translategemma-4b-it\", trust_remote_code=True)
print(\"Model access confirmed!\")
"

echo ""
echo "[Container] Starting ONNX conversion..."
echo "[Container] Started at: $(date)"
START=$(date +%s)

cd /tmp/transformers.js
python3 -m scripts.convert \
    --model_id google/translategemma-4b-it \
    --output_parent_dir /output \
    --task image-text-to-text \
    --trust_remote_code \
    --quantize \
    -- --modes fp16 q4

END=$(date +%s)
DURATION=$((END - START))
echo ""
echo "[Container] Conversion completed in $((DURATION / 60)) minutes $((DURATION % 60)) seconds"

echo ""
echo "[Container] Output contents:"
ls -lah /output/

if [ -d "/output/onnx" ]; then
    echo ""
    echo "[Container] ONNX files:"
    ls -lah /output/onnx/
fi

echo ""
echo "[Container] Done!"
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

if [ -d "$OUTPUT_DIR/onnx" ]; then
    log ""
    log "ONNX files:"
    ls -lah "$OUTPUT_DIR/onnx" 2>&1 | tee -a "$LOG_FILE"
fi

TOTAL_SIZE=$(du -sh "$OUTPUT_DIR" | cut -f1)
log "Total size: $TOTAL_SIZE"

log ""
log "Next: Upload to HuggingFace with:"
log "  huggingface-cli upload m1cc0z/translategemma-4b-onnx $OUTPUT_DIR"

echo ""
echo "Done! Log: $LOG_FILE"
