#!/bin/bash
# Quantize TranslateGemma ONNX models to INT4 (q4) in Docker
set -e

echo "=== Installing dependencies ==="
pip3 install --quiet onnxruntime==1.20.1 onnx && pip3 show onnxruntime | grep Version

echo "=== Running Q4 quantization ==="
python3 << 'PYTHON_SCRIPT'
import os
import shutil
from pathlib import Path
import onnx
from onnxruntime.quantization.matmul_4bits_quantizer import MatMul4BitsQuantizer

INPUT_DIR = Path("/onnx-input")
OUTPUT_DIR = Path("/onnx-output-q4")

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

def quantize_model_q4(model_path: Path, output_path: Path):
    """Quantize model to 4-bit using MatMul4BitsQuantizer."""
    print(f"Quantizing {model_path.name} to Q4...")

    # Load model with external data
    data_path = Path(str(model_path) + ".data")
    has_external = data_path.exists()

    if has_external:
        print(f"  Loading model with external data...")
        model = onnx.load(str(model_path), load_external_data=True)
    else:
        model = onnx.load(str(model_path))

    # Quantize
    print("  Applying INT4 quantization...")
    quantizer = MatMul4BitsQuantizer(
        model=model,
        block_size=32,
        is_symmetric=True,
        accuracy_level=None,
    )
    quantizer.process()

    # Save with external data if original had it
    print(f"  Saving to {output_path}...")
    quantizer.model.save_model_to_file(str(output_path), use_external_data_format=True)

    # Get sizes
    orig_size = model_path.stat().st_size
    if has_external:
        orig_size += data_path.stat().st_size

    new_size = output_path.stat().st_size
    new_data_path = Path(str(output_path) + ".data")
    if new_data_path.exists():
        new_size += new_data_path.stat().st_size

    compression = new_size / orig_size * 100
    print(f"  {orig_size / 1e9:.2f} GB -> {new_size / 1e9:.2f} GB ({compression:.1f}%)")
    return output_path

# Process decoder (largest model - benefits most from q4)
model_name = "decoder_model_merged"
model_path = INPUT_DIR / f"{model_name}.onnx"
if model_path.exists():
    try:
        quantize_model_q4(
            model_path,
            OUTPUT_DIR / f"{model_name}_q4.onnx"
        )
    except Exception as e:
        print(f"Q4 quantization of {model_name} failed: {e}")
        import traceback
        traceback.print_exc()

print("\n=== Final Q4 Output ===")
for f in sorted(OUTPUT_DIR.rglob("*")):
    if f.is_file():
        size_mb = f.stat().st_size / (1024 * 1024)
        print(f"  {f.name}: {size_mb:.1f} MB")

print("\nDone!")
PYTHON_SCRIPT
