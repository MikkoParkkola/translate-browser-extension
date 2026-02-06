#!/bin/bash
# TranslateGemma-4B to ONNX conversion on DGX Spark
# Uses optimum v2.1.0 + transformers 4.57+ for gemma3 support
set -e

OUTPUT_DIR="/output/translategemma-onnx"
MODEL_ID="google/translategemma-4b-it"

# HuggingFace auth from mounted cache
export HF_HOME=/hf_cache
export HUGGINGFACE_HUB_CACHE=/hf_cache

echo "=== Installing dependencies ==="
pip3 install --quiet --upgrade optimum[onnxruntime]==2.1.0 onnxslim onnxscript

echo "=== Testing imports ==="
python3 -c "
from optimum.exporters.onnx import main_export
from transformers import AutoConfig
print('Imports OK')
config = AutoConfig.from_pretrained('$MODEL_ID', trust_remote_code=True)
print(f'Model type: {config.model_type}')
print(f'Architectures: {config.architectures}')
"

echo "=== Checking if gemma3 is in supported models ==="
python3 -c "
from optimum.exporters.tasks import TasksManager
supported = TasksManager._SUPPORTED_MODEL_TYPE
if 'gemma3' in supported:
    print('gemma3 is supported!')
    print(f'Tasks: {list(supported[\"gemma3\"].keys())}')
elif 'gemma' in supported:
    print('gemma is supported (checking if gemma3 falls back)')
    print(f'Tasks: {list(supported[\"gemma\"].keys())}')
else:
    print('gemma3 NOT in supported models')
    print('Available vision-language models:')
    for m in sorted(supported.keys()):
        if 'vision' in str(supported[m].get('onnx', {})).lower() or 'image' in str(supported[m].get('onnx', {})).lower():
            print(f'  {m}: {list(supported[m].keys())}')
"

echo "=== Attempting export ==="
mkdir -p "$OUTPUT_DIR"

# Try standard export first
python3 -c "
from optimum.exporters.onnx import main_export
try:
    main_export(
        model_name_or_path='$MODEL_ID',
        output='$OUTPUT_DIR',
        task='image-text-to-text',
        device='cuda',
        fp16=True,
        trust_remote_code=True,
    )
    print('Export succeeded!')
except Exception as e:
    print(f'Standard export failed: {e}')
    print('Will try custom approach...')
"

echo "=== Done ==="
ls -la "$OUTPUT_DIR/" 2>/dev/null || echo "Output directory empty or doesn't exist"
