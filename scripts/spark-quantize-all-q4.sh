#!/bin/bash
# Quantize ALL TranslateGemma components to Q4
set -e

echo "=== Installing dependencies ==="
pip3 install --quiet onnxruntime==1.20.1 onnx

echo "=== Running full Q4 quantization ==="
python3 << 'PYTHON_SCRIPT'
import os
from pathlib import Path
import onnx
from onnxruntime.quantization.matmul_4bits_quantizer import MatMul4BitsQuantizer

INPUT_DIR = Path("/onnx-input")
OUTPUT_DIR = Path("/onnx-output-q4-full")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

def quantize_q4(model_path: Path, output_path: Path):
    """Quantize model to Q4 (4-bit)."""
    print(f"\nQuantizing {model_path.name} to Q4...")

    data_path = Path(str(model_path) + ".data")
    has_external = data_path.exists()

    if has_external:
        print(f"  Loading with external data ({data_path.stat().st_size / 1e9:.2f} GB)...")
        model = onnx.load(str(model_path), load_external_data=True)
    else:
        model = onnx.load(str(model_path))

    orig_size = model_path.stat().st_size
    if has_external:
        orig_size += data_path.stat().st_size

    print(f"  Original size: {orig_size / 1e9:.2f} GB")
    print(f"  Applying Q4 quantization (block_size=32, symmetric)...")

    quantizer = MatMul4BitsQuantizer(
        model=model,
        block_size=32,
        is_symmetric=True,
        accuracy_level=None,
    )
    quantizer.process()

    print(f"  Saving to {output_path}...")
    quantizer.model.save_model_to_file(str(output_path), use_external_data_format=True)

    new_size = output_path.stat().st_size
    new_data = Path(str(output_path) + ".data")
    if new_data.exists():
        new_size += new_data.stat().st_size

    ratio = new_size / orig_size * 100
    print(f"  {orig_size / 1e9:.2f} GB -> {new_size / 1e9:.2f} GB ({ratio:.1f}%)")

# Quantize all components
for name in ["vision_encoder", "embed_tokens", "decoder_model_merged"]:
    src = INPUT_DIR / f"{name}.onnx"
    if src.exists():
        try:
            quantize_q4(src, OUTPUT_DIR / f"{name}_q4.onnx")
        except Exception as e:
            print(f"  FAILED: {e}")

print("\n=== Final Q4 Models ===")
total = 0
for f in sorted(OUTPUT_DIR.glob("*.onnx*")):
    size = f.stat().st_size
    total += size
    print(f"  {f.name}: {size / 1e6:.1f} MB")
print(f"\n  TOTAL: {total / 1e9:.2f} GB")
PYTHON_SCRIPT
