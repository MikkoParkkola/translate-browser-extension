#!/bin/bash
# spark-upload.sh
# Upload converted TranslateGemma model to HuggingFace Hub
#
# Usage: ./spark-upload.sh [repo-name]

REPO_NAME="${1:-translategemma-4b-onnx}"
OUTPUT_DIR="$HOME/translategemma-4b-onnx"

# Get HuggingFace username
HF_USER=$(huggingface-cli whoami 2>/dev/null | head -1)

if [ -z "$HF_USER" ]; then
    echo "ERROR: Not logged in to HuggingFace"
    echo "Run: huggingface-cli login"
    exit 1
fi

FULL_REPO="$HF_USER/$REPO_NAME"

echo "Uploading to: $FULL_REPO"
echo "Source: $OUTPUT_DIR"
echo ""

# Check if output exists
if [ ! -d "$OUTPUT_DIR" ]; then
    echo "ERROR: Output directory not found: $OUTPUT_DIR"
    echo "Run the conversion first: ./spark-convert-translategemma.sh"
    exit 1
fi

# Show what will be uploaded
echo "Files to upload:"
du -sh "$OUTPUT_DIR"/*
echo ""

read -p "Continue with upload? (y/N) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Creating repository..."
    huggingface-cli repo create "$REPO_NAME" --type model 2>/dev/null || true

    echo "Uploading (this may take 10-15 minutes for ~1GB)..."
    huggingface-cli upload "$FULL_REPO" "$OUTPUT_DIR" . \
        --repo-type model \
        --commit-message "Add TranslateGemma-4B ONNX with q4 quantization"

    echo ""
    echo "Upload complete!"
    echo "Model URL: https://huggingface.co/$FULL_REPO"
else
    echo "Upload cancelled"
fi
