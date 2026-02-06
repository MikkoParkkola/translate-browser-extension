#!/usr/bin/env python3
"""
Quantize TranslateGemma ONNX models to INT4 for browser inference.
"""
import os
import shutil
from pathlib import Path
from onnxruntime.quantization import quantize_dynamic, QuantType
from onnxruntime.quantization.matmul_4bits_quantizer import MatMul4BitsQuantizer
import onnx

INPUT_DIR = Path("/tmp/translategemma-onnx/onnx")
OUTPUT_DIR = Path("/tmp/translategemma-onnx-q4/onnx")

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

def quantize_model_q4(model_path: Path, output_path: Path):
    """Quantize model to 4-bit using MatMul4BitsQuantizer."""
    print(f"Quantizing {model_path.name} to INT4...")

    # Load the model
    model = onnx.load(str(model_path))

    # Use MatMul4BitsQuantizer for INT4 quantization
    quantizer = MatMul4BitsQuantizer(
        model=model,
        block_size=32,
        is_symmetric=True,
        accuracy_level=None,
    )
    quantizer.process()
    quantizer.model.save_model_to_file(str(output_path), True)

    # Get sizes
    orig_size = model_path.stat().st_size
    data_path = Path(str(model_path) + ".data")
    if data_path.exists():
        orig_size += data_path.stat().st_size

    new_size = output_path.stat().st_size
    new_data_path = Path(str(output_path) + ".data")
    if new_data_path.exists():
        new_size += new_data_path.stat().st_size

    print(f"  {orig_size / 1e9:.2f} GB -> {new_size / 1e9:.2f} GB ({new_size / orig_size * 100:.1f}%)")
    return output_path

def quantize_model_int8(model_path: Path, output_path: Path):
    """Quantize model to INT8 using dynamic quantization."""
    print(f"Quantizing {model_path.name} to INT8...")

    quantize_dynamic(
        str(model_path),
        str(output_path),
        weight_type=QuantType.QUInt8,
    )

    # Get sizes
    orig_size = model_path.stat().st_size
    data_path = Path(str(model_path) + ".data")
    if data_path.exists():
        orig_size += data_path.stat().st_size

    new_size = output_path.stat().st_size
    new_data_path = Path(str(output_path) + ".data")
    if new_data_path.exists():
        new_size += new_data_path.stat().st_size

    print(f"  {orig_size / 1e9:.2f} GB -> {new_size / 1e9:.2f} GB ({new_size / orig_size * 100:.1f}%)")
    return output_path

# Quantize each component
print("\n=== Quantizing Vision Encoder (INT8) ===")
try:
    quantize_model_int8(
        INPUT_DIR / "vision_encoder.onnx",
        OUTPUT_DIR / "vision_encoder_int8.onnx"
    )
except Exception as e:
    print(f"Vision encoder quantization failed: {e}")
    # Copy original as fallback
    shutil.copy(INPUT_DIR / "vision_encoder.onnx", OUTPUT_DIR / "vision_encoder.onnx")
    data_file = INPUT_DIR / "vision_encoder.onnx.data"
    if data_file.exists():
        shutil.copy(data_file, OUTPUT_DIR / "vision_encoder.onnx.data")

print("\n=== Quantizing Embeddings (INT8) ===")
try:
    quantize_model_int8(
        INPUT_DIR / "embed_tokens.onnx",
        OUTPUT_DIR / "embed_tokens_int8.onnx"
    )
except Exception as e:
    print(f"Embeddings quantization failed: {e}")
    # Copy original as fallback
    shutil.copy(INPUT_DIR / "embed_tokens.onnx", OUTPUT_DIR / "embed_tokens.onnx")
    data_file = INPUT_DIR / "embed_tokens.onnx.data"
    if data_file.exists():
        shutil.copy(data_file, OUTPUT_DIR / "embed_tokens.onnx.data")

print("\n=== Quantizing Decoder (Q4) ===")
try:
    quantize_model_q4(
        INPUT_DIR / "decoder_model_merged.onnx",
        OUTPUT_DIR / "decoder_model_merged_q4.onnx"
    )
except Exception as e:
    print(f"Decoder Q4 quantization failed: {e}")
    import traceback
    traceback.print_exc()

print("\n=== Final Output ===")
for f in sorted(OUTPUT_DIR.rglob("*")):
    if f.is_file():
        size_mb = f.stat().st_size / (1024 * 1024)
        print(f"  {f.name}: {size_mb:.1f} MB")

print("\nDone!")
