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

# Install optimum first, then upgrade transformers to support gemma3
echo "[Container] Installing optimum..."
pip install --quiet "optimum[onnxruntime]==1.19.0" onnx accelerate

echo "[Container] Upgrading transformers for gemma3 support..."
pip install --quiet --upgrade "transformers>=4.45" sentencepiece protobuf
pip install --quiet onnxconverter-common huggingface_hub onnxslim

echo ""
echo "[Container] Verifying transformers version..."
python3 -c "import transformers; print(f'transformers={transformers.__version__}')"

echo ""
echo "[Container] Testing model access..."
python3 -c "
from transformers import AutoConfig
config = AutoConfig.from_pretrained('google/translategemma-4b-it', trust_remote_code=True)
print(f'Model type: {config.model_type}')
print('Model access confirmed!')
"

echo ""
echo "[Container] Starting ONNX conversion with optimum-cli..."
echo "[Container] Started at: $(date)"
START=$(date +%s)

# Export to ONNX using optimum-cli with CUDA for fp16
echo "[Container] Exporting to ONNX (fp16)..."
optimum-cli export onnx \
    --model google/translategemma-4b-it \
    --task image-text-to-text \
    --trust-remote-code \
    --device cuda \
    --dtype fp16 \
    /output/onnx

# Quantize to int4 using onnxruntime
echo ""
echo "[Container] Quantizing to int4..."
python3 -c "
from onnxruntime.quantization import quantize_dynamic, QuantType
import os
import glob

onnx_dir = '/output/onnx'
for onnx_file in glob.glob(os.path.join(onnx_dir, '*.onnx')):
    if '_quantized' not in onnx_file and '_q4' not in onnx_file:
        output_file = onnx_file.replace('.onnx', '_q4.onnx')
        print(f'Quantizing {onnx_file} -> {output_file}')
        try:
            quantize_dynamic(onnx_file, output_file, weight_type=QuantType.QUInt4x2)
        except Exception as e:
            print(f'Warning: Could not quantize {onnx_file}: {e}')
"

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
