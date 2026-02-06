#!/bin/bash
# Quantize TranslateGemma ONNX models to INT4 in Docker
set -e

echo "=== Installing dependencies ==="
pip3 install --quiet onnxruntime onnx

echo "=== Running quantization ==="
python3 << 'PYTHON_SCRIPT'
import os
import shutil
from pathlib import Path
from onnxruntime.quantization import quantize_dynamic, QuantType

INPUT_DIR = Path("/onnx-input")
OUTPUT_DIR = Path("/onnx-output")

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

def quantize_model_int8(model_path: Path, output_path: Path):
    """Quantize model to INT8 using dynamic quantization."""
    print(f"Quantizing {model_path.name} to INT8...")

    # Check if external data exists
    data_path = Path(str(model_path) + ".data")
    has_external = data_path.exists()

    if has_external:
        print(f"  Model has external data: {data_path.name}")

    quantize_dynamic(
        str(model_path),
        str(output_path),
        weight_type=QuantType.QUInt8,
        use_external_data_format=has_external,
    )

    # Get sizes
    orig_size = model_path.stat().st_size
    if has_external:
        orig_size += data_path.stat().st_size

    new_size = output_path.stat().st_size
    new_data_path = Path(str(output_path) + ".data")
    if new_data_path.exists():
        new_size += new_data_path.stat().st_size

    print(f"  {orig_size / 1e9:.2f} GB -> {new_size / 1e9:.2f} GB ({new_size / orig_size * 100:.1f}%)")
    return output_path

# Process each model
for model_name in ["vision_encoder", "embed_tokens", "decoder_model_merged"]:
    model_path = INPUT_DIR / f"{model_name}.onnx"
    if model_path.exists():
        try:
            quantize_model_int8(
                model_path,
                OUTPUT_DIR / f"{model_name}_int8.onnx"
            )
        except Exception as e:
            print(f"Quantization of {model_name} failed: {e}")
            import traceback
            traceback.print_exc()
            # Copy original
            print(f"Copying original {model_name}...")
            shutil.copy(model_path, OUTPUT_DIR / f"{model_name}.onnx")
            data_path = Path(str(model_path) + ".data")
            if data_path.exists():
                shutil.copy(data_path, OUTPUT_DIR / f"{model_name}.onnx.data")

print("\n=== Final Output ===")
for f in sorted(OUTPUT_DIR.rglob("*")):
    if f.is_file():
        size_mb = f.stat().st_size / (1024 * 1024)
        print(f"  {f.name}: {size_mb:.1f} MB")

print("\nDone!")
PYTHON_SCRIPT
