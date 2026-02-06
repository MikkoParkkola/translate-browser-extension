#!/bin/bash
# spark-convert-simple.sh
# TranslateGemma-4B conversion using system Python
# Run in tmux for persistence

set -e

MODEL_ID="google/translategemma-4b-it"
OUTPUT_DIR="$HOME/translategemma-4b-onnx"
LOG_FILE="$HOME/translategemma-conversion.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Initialize log
echo "" > "$LOG_FILE"
log "=========================================="
log "TranslateGemma-4B Conversion Started"
log "=========================================="
log "Model: $MODEL_ID"
log "Output: $OUTPUT_DIR"

# Step 1: Install dependencies
log ""
log "Step 1/5: Installing dependencies..."
pip3 install --user --upgrade pip 2>&1 | tee -a "$LOG_FILE"
pip3 install --user transformers optimum onnx onnxruntime accelerate 2>&1 | tee -a "$LOG_FILE"
pip3 install --user onnxconverter-common 2>&1 | tee -a "$LOG_FILE"

# Step 2: Clone Transformers.js
log ""
log "Step 2/5: Setting up conversion tools..."
TFJS_DIR="$HOME/transformers.js"
if [ ! -d "$TFJS_DIR" ]; then
    git clone https://github.com/xenova/transformers.js "$TFJS_DIR" 2>&1 | tee -a "$LOG_FILE"
else
    log "Transformers.js already exists, updating..."
    cd "$TFJS_DIR" && git pull 2>&1 | tee -a "$LOG_FILE"
fi

cd "$TFJS_DIR"
pip3 install --user -e ".[dev]" 2>&1 | tee -a "$LOG_FILE"

# Step 3: Test model access
log ""
log "Step 3/5: Testing model access..."
python3 << 'PYEOF' 2>&1 | tee -a "$LOG_FILE"
from transformers import AutoProcessor
import os

model_id = "google/translategemma-4b-it"
print(f"Testing access to {model_id}...")

try:
    processor = AutoProcessor.from_pretrained(model_id, trust_remote_code=True)
    print("Model access confirmed!")
except Exception as e:
    print(f"ERROR: {e}")
    print("You may need to accept the model license at:")
    print(f"https://huggingface.co/{model_id}")
    exit(1)
PYEOF

# Step 4: Convert to ONNX
log ""
log "Step 4/5: Converting to ONNX (this takes ~40 minutes)..."
log "Started at: $(date)"

START_TIME=$(date +%s)

mkdir -p "$OUTPUT_DIR"

cd "$TFJS_DIR"
python3 -m scripts.convert \
    --model_id "$MODEL_ID" \
    --output_parent_dir "$OUTPUT_DIR" \
    --task image-text-to-text \
    --trust_remote_code \
    --quantize \
    -- --modes fp16 q4 2>&1 | tee -a "$LOG_FILE"

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

log ""
log "Conversion completed in $((DURATION / 60)) minutes $((DURATION % 60)) seconds"

# Step 5: Verify output
log ""
log "Step 5/5: Verifying output..."
log "Output contents:"
ls -lah "$OUTPUT_DIR" 2>&1 | tee -a "$LOG_FILE"

if [ -d "$OUTPUT_DIR/onnx" ]; then
    log ""
    log "ONNX files:"
    ls -lah "$OUTPUT_DIR/onnx" 2>&1 | tee -a "$LOG_FILE"
fi

TOTAL_SIZE=$(du -sh "$OUTPUT_DIR" | cut -f1)
log ""
log "Total size: $TOTAL_SIZE"

# Done
log ""
log "=========================================="
log "CONVERSION COMPLETE!"
log "=========================================="
log "Output: $OUTPUT_DIR"
log "Duration: $((DURATION / 60)) minutes"
log ""
log "Next: Upload to HuggingFace with:"
log "  huggingface-cli upload m1cc0z/translategemma-4b-onnx $OUTPUT_DIR"

echo ""
echo "Done! Check log at: $LOG_FILE"
