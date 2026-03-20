#!/usr/bin/env python3
"""
Fix ONNX Mixed Precision Type Mismatch for TranslateGemma

Problem: The model_q4f16.onnx was exported with fp16=True then q4 quantized.
413 Cast nodes upcast fp16->fp32 for numerical stability in LayerNorm, RMSNorm,
Q/K norm, rotary embeddings, etc. ONNX Runtime WebGPU rejects the mixed types:
"Type parameter (T) of Optype (Mul) bound to different types"

Root cause categories:
  - 275 Cast nodes in LayerNorm/RMSNorm (input_layernorm, post_attention_layernorm,
    pre_feedforward_layernorm) that upcast fp16->fp32
  - 70 Cast nodes in Q/K normalization (q_norm, k_norm per layer)
  - 66 Cast nodes for past_key_values and attention
  - 2 Cast nodes in rotary embeddings (position encoding int->fp32)

Fix: Change all 412 Cast(to=float32) nodes to Cast(to=float16), except the
final logits output cast which intentionally stays fp32 for softmax precision.

The model also requires manual external data handling because protobuf has a
2GB message size limit and the model weights total ~3.3GB.

Usage:
    # Run on a machine with 8GB+ RAM (model is ~3.3GB)
    python fix_onnx_mixed_precision.py [--upload]
"""

import argparse
import sys
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, numpy_helper


REPO_ID = "m1cc0z/translategemma-4b-it-onnx-q4-webgpu"
WORK_DIR = Path("/tmp/translategemma-fix")

# The logits output Cast should stay fp32 (softmax needs precision)
KEEP_FP32_CASTS = {"/lm_head/MatMul_Q4_cast_to_logits"}


def download_model() -> Path:
    """Download model_q4f16 files from HuggingFace."""
    from huggingface_hub import hf_hub_download

    print("Downloading model files...")
    files = [
        "onnx/model_q4f16.onnx",
        "onnx/model_q4f16.onnx_data",
        "onnx/model_q4f16.onnx_data_1",
    ]
    for f in files:
        local = hf_hub_download(repo_id=REPO_ID, filename=f, local_dir=WORK_DIR)
        size_mb = Path(local).stat().st_size / 1024 / 1024
        print(f"  {f}: {size_mb:.1f} MB")

    return WORK_DIR / "onnx" / "model_q4f16.onnx"


def fix_fp32_casts(model: onnx.ModelProto) -> tuple[int, int]:
    """Change Cast(to=float32) nodes to Cast(to=float16).

    Skips the logits output cast which intentionally stays fp32.
    Returns (fixed_count, skipped_count).
    """
    fixed = 0
    skipped = 0

    for node in model.graph.node:
        if node.op_type != "Cast":
            continue
        for attr in node.attribute:
            if attr.name == "to" and attr.i == TensorProto.FLOAT:
                if node.name in KEEP_FP32_CASTS:
                    skipped += 1
                else:
                    attr.i = TensorProto.FLOAT16
                    fixed += 1

    return fixed, skipped


def count_fp32_casts(model: onnx.ModelProto) -> tuple[int, list[str]]:
    """Count remaining Cast(to=float32) nodes."""
    count = 0
    names = []
    for node in model.graph.node:
        if node.op_type != "Cast":
            continue
        for attr in node.attribute:
            if attr.name == "to" and attr.i == TensorProto.FLOAT:
                count += 1
                names.append(node.name)
    return count, names


def save_with_external_data(
    model: onnx.ModelProto,
    output_dir: Path,
    filename: str = "model_q4f16.onnx",
) -> list[Path]:
    """Save model with split external data files (<2GB each for browsers).

    Uses manual external data writing because protobuf's 2GB message limit
    prevents onnx.save_model from properly handling 3.3GB of inline tensor data.
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    # Clean old files
    for old in output_dir.glob(f"{Path(filename).stem}*"):
        old.unlink()

    output_path = output_dir / filename
    data_file_0 = output_dir / f"{Path(filename).stem}.onnx_data"
    data_file_1 = output_dir / f"{Path(filename).stem}.onnx_data_1"
    MAX_FILE_SIZE = 1_900_000_000  # Stay under 2GB for browser compatibility

    print(f"  Writing external data...")
    offset_0 = 0
    offset_1 = 0
    current_file = 0
    externalized = 0

    with open(data_file_0, "wb") as f0, open(data_file_1, "wb") as f1:
        for tensor in model.graph.initializer:
            data = tensor.raw_data
            if len(data) < 1024:
                continue  # Keep small tensors inline

            # Switch to second file if first would exceed limit
            if current_file == 0 and offset_0 + len(data) > MAX_FILE_SIZE:
                current_file = 1

            if current_file == 0:
                # Align to 16 bytes for efficient memory access
                pad = (16 - (offset_0 % 16)) % 16
                if pad:
                    f0.write(b"\0" * pad)
                    offset_0 += pad
                f0.write(data)
                location = data_file_0.name
                offset = offset_0
                offset_0 += len(data)
            else:
                pad = (16 - (offset_1 % 16)) % 16
                if pad:
                    f1.write(b"\0" * pad)
                    offset_1 += pad
                f1.write(data)
                location = data_file_1.name
                offset = offset_1
                offset_1 += len(data)

            # Update tensor to reference external file
            tensor.ClearField("raw_data")
            tensor.data_location = TensorProto.EXTERNAL
            while tensor.external_data:
                tensor.external_data.pop()

            for key, value in [
                ("location", location),
                ("offset", str(offset)),
                ("length", str(len(data))),
            ]:
                entry = tensor.external_data.add()
                entry.key = key
                entry.value = value

            externalized += 1

    print(f"  Externalized: {externalized} tensors")
    print(f"  {data_file_0.name}: {offset_0 / 1024 / 1024:.1f} MB")
    print(f"  {data_file_1.name}: {offset_1 / 1024 / 1024:.1f} MB")

    # Save the graph (now small enough for protobuf)
    graph_bytes = model.SerializeToString()
    with open(output_path, "wb") as f:
        f.write(graph_bytes)
    print(f"  Graph: {len(graph_bytes) / 1024 / 1024:.1f} MB")

    output_files = sorted(output_dir.glob(f"{Path(filename).stem}*"))
    total_size = sum(f.stat().st_size for f in output_files) / 1024 / 1024
    print(f"  Total: {total_size:.1f} MB")

    return output_files


def verify_with_ort(model_path: Path) -> bool:
    """Verify model loads with ONNX Runtime (no type errors)."""
    try:
        import onnxruntime as ort

        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
        session = ort.InferenceSession(
            str(model_path), opts, providers=["CPUExecutionProvider"]
        )
        print("  PASS: Model loaded successfully!")
        for inp in session.get_inputs()[:2]:
            print(f"    Input: {inp.name} type={inp.type} shape={inp.shape}")
        for out in session.get_outputs()[:1]:
            print(f"    Output: {out.name} type={out.type} shape={out.shape}")
        return True
    except Exception as e:
        print(f"  FAIL: {str(e)[:300]}")
        return False


def upload_files(files: list[Path]) -> None:
    """Upload fixed files to HuggingFace."""
    from huggingface_hub import HfApi

    api = HfApi()
    print(f"\nUploading {len(files)} files to {REPO_ID}...")
    for f in files:
        remote_path = f"onnx/{f.name}"
        size_mb = f.stat().st_size / 1024 / 1024
        print(f"  {f.name} ({size_mb:.1f} MB) -> {remote_path}")
        api.upload_file(
            path_or_fileobj=str(f),
            path_in_repo=remote_path,
            repo_id=REPO_ID,
            repo_type="model",
        )
    print("Upload complete!")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fix TranslateGemma ONNX float32/float16 type mismatch"
    )
    parser.add_argument("--upload", action="store_true", help="Upload to HuggingFace")
    parser.add_argument("--model-path", type=str, help="Local model_q4f16.onnx path")
    parser.add_argument("--dry-run", action="store_true", help="Analyze only, no save")
    args = parser.parse_args()

    # Step 1: Get model
    if args.model_path:
        model_path = Path(args.model_path)
    else:
        model_path = download_model()

    # Step 2: Quick analysis (graph-only, fast)
    print(f"\nLoading ONNX graph (no weights)...")
    model_graph = onnx.load(str(model_path), load_external_data=False)
    print(f"  Nodes: {len(model_graph.graph.node)}")

    fp32_cast_count, fp32_cast_names = count_fp32_casts(model_graph)
    print(f"  Cast(to=float32) nodes: {fp32_cast_count}")

    if fp32_cast_count <= 1:
        print("\nModel appears already fixed (only logits cast remaining).")
        sys.exit(0)

    if args.dry_run:
        print(f"\nDry run: would fix {fp32_cast_count - 1} Cast nodes. Exiting.")
        sys.exit(0)

    del model_graph

    # Step 3: Load full model with weights (~3.3GB)
    print(f"\nLoading full model with weights...")
    model = onnx.load(str(model_path))

    # Step 4: Fix
    fixed, skipped = fix_fp32_casts(model)
    print(f"\nFixed {fixed} Cast nodes (fp32->fp16), kept {skipped} (logits)")

    # Step 5: Verify remaining
    remaining, remaining_names = count_fp32_casts(model)
    print(f"Remaining Cast(to=float32): {remaining}")
    for name in remaining_names:
        print(f"  {name}")

    # Step 6: Save with external data
    output_dir = WORK_DIR / "fixed_output"
    output_files = save_with_external_data(model, output_dir)

    del model  # Free ~3.3GB

    # Step 7: ORT verification
    print(f"\nONNX Runtime verification:")
    output_path = output_dir / "model_q4f16.onnx"
    ort_ok = verify_with_ort(output_path)

    if not ort_ok:
        print("\nFix did not resolve all type errors!")
        sys.exit(1)

    # Step 8: Upload
    if args.upload:
        q4f16_files = [f for f in output_files if "q4f16" in f.name]
        upload_files(q4f16_files)
    else:
        print(f"\nTo upload: python fix_onnx_mixed_precision.py --upload")

    print("\nAfter upload, clear browser cache and reload extension.")
    print("The extension auto-selects q4f16 when WebGPU shader-f16 is available.")


if __name__ == "__main__":
    main()
