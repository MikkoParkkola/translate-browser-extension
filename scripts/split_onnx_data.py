#!/usr/bin/env python3
"""
Split ONNX external data at tensor-safe boundaries for browser compatibility.

Browsers cannot allocate ArrayBuffers > 2GB, so the 3.5GB model_q4.onnx_data
must be split into smaller chunks. Transformers.js supports chunked external
data with the naming convention:
  - model_q4.onnx_data   (chunk 0)
  - model_q4.onnx_data_1 (chunk 1)
  - model_q4.onnx_data_2 (chunk 2)

CRITICAL: Splits must occur at tensor boundaries. If a split cuts through a
tensor's data, ONNX Runtime Web will fail with "Out of bounds" because it
looks up each tensor by its (filename, offset, length) and the chunk file
is shorter than the original.

This script:
1. Downloads model files from HuggingFace (handles pre-split chunks)
2. Reconstructs the original contiguous data file if needed
3. Reads the ONNX protobuf to find all tensor data locations
4. Computes tensor-safe split boundaries
5. Splits data AND updates protobuf references
6. Uploads the corrected files to HuggingFace
"""

import json
import shutil
import struct
import sys
from pathlib import Path

import onnx
from huggingface_hub import HfApi, hf_hub_download

REPO_ID = "m1cc0z/translategemma-4b-it-onnx-q4-webgpu"
WORK_DIR = Path("/tmp/tg-split")
OUTPUT_DIR = WORK_DIR / "output"

# Target: each chunk < 1.9 GB (safe margin under 2GB ArrayBuffer limit)
MAX_CHUNK_SIZE = 1_900_000_000

ONNX_SUBDIR = "onnx"
MODEL_NAME = "model_q4"


def download_model() -> None:
    """Download all files from the HuggingFace repo."""
    print(f"Downloading model files to {WORK_DIR}...")
    api = HfApi()
    files = api.list_repo_files(REPO_ID)

    for f in files:
        if f == ".gitattributes":
            continue
        print(f"  {f}...")
        hf_hub_download(REPO_ID, f, local_dir=str(WORK_DIR))

    print("Download complete.")


def reconstruct_data() -> Path:
    """Reconstruct contiguous data file from chunks if needed.

    Returns path to the single contiguous data file.
    """
    onnx_dir = WORK_DIR / ONNX_SUBDIR
    single = onnx_dir / f"{MODEL_NAME}.onnx_data"

    # Check if chunks exist (from previous naive split)
    chunk1 = onnx_dir / f"{MODEL_NAME}.onnx_data_1"
    chunk2 = onnx_dir / f"{MODEL_NAME}.onnx_data_2"

    if chunk1.exists() or chunk2.exists():
        print("\nReconstructing contiguous data file from chunks...")
        contiguous = onnx_dir / f"{MODEL_NAME}.onnx_data_full"

        with open(contiguous, "wb") as out:
            # Chunk 0 = model_q4.onnx_data
            if single.exists():
                size = single.stat().st_size
                print(f"  Chunk 0: {size / 1024**2:.1f} MB")
                with open(single, "rb") as f:
                    shutil.copyfileobj(f, out)

            # Chunk 1, 2, ...
            i = 1
            while True:
                chunk_path = onnx_dir / f"{MODEL_NAME}.onnx_data_{i}"
                if not chunk_path.exists():
                    break
                size = chunk_path.stat().st_size
                print(f"  Chunk {i}: {size / 1024**2:.1f} MB")
                with open(chunk_path, "rb") as f:
                    shutil.copyfileobj(f, out)
                i += 1

        total = contiguous.stat().st_size
        print(f"  Reconstructed: {total / 1024**3:.2f} GB ({total:,} bytes)")
        return contiguous
    elif single.exists():
        print(f"\nSingle data file exists: {single.stat().st_size / 1024**3:.2f} GB")
        return single
    else:
        print("ERROR: No data files found!")
        sys.exit(1)


def get_tensor_ranges(model_path: Path) -> list[tuple[int, int, str]]:
    """Read ONNX protobuf and extract all external tensor (offset, end, name).

    Returns sorted list of (offset, end_offset, tensor_name).
    """
    model = onnx.load(str(model_path), load_external_data=False)

    ranges = []
    for tensor in model.graph.initializer:
        ext = {}
        for entry in tensor.external_data:
            ext[entry.key] = entry.value

        if "location" in ext:
            offset = int(ext.get("offset", "0"))
            length = int(ext.get("length", "0"))
            if length > 0:
                ranges.append((offset, offset + length, tensor.name))

    ranges.sort(key=lambda x: x[0])
    print(f"\nFound {len(ranges)} external tensors")
    if ranges:
        print(f"  Data range: 0 .. {ranges[-1][1]:,} bytes")
        largest = max(ranges, key=lambda x: x[1] - x[0])
        print(f"  Largest tensor: {largest[2]} ({(largest[1] - largest[0]) / 1024**2:.1f} MB)")

    return ranges


def find_split_points(
    ranges: list[tuple[int, int, str]], total_size: int
) -> list[int]:
    """Find split points that don't cut through any tensor.

    Returns list of split offsets (byte positions where new chunks start).
    """
    # Build sorted list of tensor end positions as candidate split points
    # A split point is valid if it falls between [end of tensor N] and [start of tensor N+1]
    # We want chunks < MAX_CHUNK_SIZE

    split_points = []
    current_chunk_start = 0

    for i, (offset, end, name) in enumerate(ranges):
        # Would adding this tensor to current chunk exceed the limit?
        if end - current_chunk_start > MAX_CHUNK_SIZE:
            # Need to split BEFORE this tensor
            # The split point is at this tensor's offset (start of next chunk)
            if offset == current_chunk_start:
                # This single tensor exceeds MAX_CHUNK_SIZE!
                size_gb = (end - offset) / 1024**3
                if end - offset > 2_000_000_000:
                    print(f"  FATAL: Tensor '{name}' is {size_gb:.2f} GB (> 2GB limit)")
                    sys.exit(1)
                else:
                    # Single tensor < 2GB but > our preferred chunk size
                    # Let it be the entire chunk
                    print(f"  WARNING: Tensor '{name}' is {size_gb:.2f} GB, using as single chunk")
                    # Split after this tensor
                    split_points.append(end)
                    current_chunk_start = end
            else:
                # Split before this tensor
                split_points.append(offset)
                current_chunk_start = offset
                # Re-check: does this tensor itself fit in the new chunk?
                if end - current_chunk_start > MAX_CHUNK_SIZE:
                    size_gb = (end - offset) / 1024**3
                    print(f"  WARNING: Tensor '{name}' is {size_gb:.2f} GB, dedicated chunk")
                    split_points.append(end)
                    current_chunk_start = end

    # Split points = boundaries between chunks
    # Chunk 0: [0, split_points[0])
    # Chunk 1: [split_points[0], split_points[1])
    # Chunk N: [split_points[-1], total_size)

    chunk_sizes = []
    prev = 0
    for sp in split_points:
        chunk_sizes.append(sp - prev)
        prev = sp
    chunk_sizes.append(total_size - prev)

    num_chunks = len(chunk_sizes)
    print(f"\nSplit plan: {num_chunks} chunks")
    for i, cs in enumerate(chunk_sizes):
        print(f"  Chunk {i}: {cs / 1024**3:.2f} GB ({cs:,} bytes)")

    # Verify no chunk exceeds 2GB
    for i, cs in enumerate(chunk_sizes):
        if cs > 2_000_000_000:
            print(f"  FATAL: Chunk {i} is {cs / 1024**3:.2f} GB (> 2GB)")
            sys.exit(1)

    return split_points


def split_data(data_path: Path, split_points: list[int]) -> list[Path]:
    """Split data file at the given byte offsets.

    Returns list of chunk file paths.
    """
    output_onnx = OUTPUT_DIR / ONNX_SUBDIR
    output_onnx.mkdir(parents=True, exist_ok=True)

    total_size = data_path.stat().st_size
    boundaries = [0] + split_points + [total_size]
    chunk_paths = []

    with open(data_path, "rb") as f:
        for i in range(len(boundaries) - 1):
            start = boundaries[i]
            end = boundaries[i + 1]
            size = end - start

            if i == 0:
                name = f"{MODEL_NAME}.onnx_data"
            else:
                name = f"{MODEL_NAME}.onnx_data_{i}"

            chunk_path = output_onnx / name
            f.seek(start)

            # Write in 64MB blocks
            with open(chunk_path, "wb") as out:
                remaining = size
                while remaining > 0:
                    block = min(remaining, 64 * 1024 * 1024)
                    data = f.read(block)
                    out.write(data)
                    remaining -= len(data)

            actual = chunk_path.stat().st_size
            print(f"  {name}: {actual / 1024**3:.2f} GB ({actual:,} bytes)")
            chunk_paths.append(chunk_path)

    return chunk_paths


def update_protobuf(
    model_path: Path,
    split_points: list[int],
    total_size: int,
) -> Path:
    """Update ONNX protobuf tensor references to point at correct chunks.

    Each tensor's external_data is updated with:
      - location: chunk filename
      - offset: byte offset within that chunk
      - length: unchanged

    Returns path to the updated protobuf.
    """
    model = onnx.load(str(model_path), load_external_data=False)

    boundaries = [0] + split_points + [total_size]
    num_chunks = len(boundaries) - 1

    # Build chunk info: [(start, end, filename), ...]
    chunks = []
    for i in range(num_chunks):
        if i == 0:
            name = f"{MODEL_NAME}.onnx_data"
        else:
            name = f"{MODEL_NAME}.onnx_data_{i}"
        chunks.append((boundaries[i], boundaries[i + 1], name))

    updated = 0
    for tensor in model.graph.initializer:
        ext = {}
        for entry in tensor.external_data:
            ext[entry.key] = entry.value

        if "location" not in ext:
            continue

        offset = int(ext.get("offset", "0"))
        length = int(ext.get("length", "0"))
        if length == 0:
            continue

        end = offset + length

        # Find which chunk this tensor belongs to
        chunk_idx = None
        for ci, (cstart, cend, cname) in enumerate(chunks):
            if offset >= cstart and end <= cend:
                chunk_idx = ci
                break

        if chunk_idx is None:
            print(f"  ERROR: Tensor '{tensor.name}' at [{offset}, {end}) spans chunk boundaries!")
            sys.exit(1)

        cstart, cend, cname = chunks[chunk_idx]
        new_offset = offset - cstart

        # Update external_data entries
        for entry in tensor.external_data:
            if entry.key == "location":
                entry.value = cname
            elif entry.key == "offset":
                entry.value = str(new_offset)
            # length stays the same

        updated += 1

    print(f"\nUpdated {updated} tensor references in protobuf")

    # Save updated protobuf
    output_onnx = OUTPUT_DIR / ONNX_SUBDIR
    output_onnx.mkdir(parents=True, exist_ok=True)
    output_path = output_onnx / f"{MODEL_NAME}.onnx"
    onnx.save(model, str(output_path))
    print(f"  Saved: {output_path} ({output_path.stat().st_size / 1024**2:.1f} MB)")

    return output_path


def copy_other_files() -> None:
    """Copy config, tokenizer, and other non-ONNX files."""
    print("\nCopying other files...")
    files_to_copy = [
        "config.json",
        "chat_template.jinja",
        "generation_config.json",
        "special_tokens_map.json",
        "tokenizer.json",
        "tokenizer_config.json",
    ]

    for f in files_to_copy:
        src = WORK_DIR / f
        if src.exists():
            dst = OUTPUT_DIR / f
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(src), str(dst))
            print(f"  {f} ({src.stat().st_size / 1024:.0f} KB)")
        else:
            print(f"  SKIP: {f} (not found)")


def update_config(num_chunks: int) -> None:
    """Set use_external_data_format in config.json."""
    config_path = OUTPUT_DIR / "config.json"
    if not config_path.exists():
        print("WARNING: config.json not found in output, creating minimal")
        config = {}
    else:
        with open(config_path) as f:
            config = json.load(f)

    config["use_external_data_format"] = num_chunks

    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)
        f.write("\n")

    print(f"  config.json: use_external_data_format = {num_chunks}")


def verify(num_chunks: int, total_size: int) -> bool:
    """Verify output integrity."""
    print(f"\n{'=' * 60}")
    print("VERIFICATION")
    print(f"{'=' * 60}")

    onnx_dir = OUTPUT_DIR / ONNX_SUBDIR
    ok = True

    # Check all chunks exist and total matches
    chunk_total = 0
    for i in range(num_chunks):
        name = f"{MODEL_NAME}.onnx_data" if i == 0 else f"{MODEL_NAME}.onnx_data_{i}"
        path = onnx_dir / name
        if not path.exists():
            print(f"  MISSING: {name}")
            ok = False
            continue
        size = path.stat().st_size
        chunk_total += size
        over = size > 2 * 1024**3
        status = "OVER 2GB!" if over else "OK"
        if over:
            ok = False
        print(f"  {name}: {size / 1024**3:.2f} GB [{status}]")

    print(f"\n  Total data: {chunk_total:,} bytes (expected: {total_size:,})")
    if chunk_total != total_size:
        print("  MISMATCH!")
        ok = False

    # Check protobuf exists
    proto = onnx_dir / f"{MODEL_NAME}.onnx"
    if proto.exists():
        print(f"  Protobuf: {proto.stat().st_size / 1024**2:.1f} MB [OK]")
    else:
        print("  Protobuf: MISSING!")
        ok = False

    # Check config
    cfg = OUTPUT_DIR / "config.json"
    if cfg.exists():
        with open(cfg) as f:
            c = json.load(f)
        edf = c.get("use_external_data_format")
        print(f"  Config: use_external_data_format = {edf}")
        if edf != num_chunks:
            print(f"  MISMATCH: expected {num_chunks}")
            ok = False
    else:
        print("  Config: MISSING!")
        ok = False

    # Verify protobuf tensor references
    if proto.exists():
        model = onnx.load(str(proto), load_external_data=False)
        valid_chunks = set()
        for i in range(num_chunks):
            valid_chunks.add(f"{MODEL_NAME}.onnx_data" if i == 0 else f"{MODEL_NAME}.onnx_data_{i}")

        bad_refs = 0
        for tensor in model.graph.initializer:
            for entry in tensor.external_data:
                if entry.key == "location" and entry.value not in valid_chunks:
                    print(f"  BAD REF: {tensor.name} -> {entry.value}")
                    bad_refs += 1
                    ok = False

        if bad_refs == 0:
            print(f"  Protobuf refs: all {len(model.graph.initializer)} tensors reference valid chunks [OK]")

    print(f"\n  Result: {'PASS' if ok else 'FAIL'}")
    return ok


def main() -> None:
    WORK_DIR.mkdir(parents=True, exist_ok=True)

    # Step 1: Download
    onnx_dir = WORK_DIR / ONNX_SUBDIR
    proto_path = onnx_dir / f"{MODEL_NAME}.onnx"
    if not proto_path.exists():
        download_model()

    # Step 2: Reconstruct contiguous data if chunks exist
    data_path = reconstruct_data()
    total_size = data_path.stat().st_size

    # Step 3: Analyze tensor boundaries from protobuf
    ranges = get_tensor_ranges(proto_path)

    # Step 4: Find tensor-safe split points
    split_points = find_split_points(ranges, total_size)
    num_chunks = len(split_points) + 1

    # Step 5: Split data at safe boundaries
    print(f"\nSplitting data file...")
    split_data(data_path, split_points)

    # Step 6: Update protobuf with correct chunk references
    print("\nUpdating protobuf tensor references...")
    update_protobuf(proto_path, split_points, total_size)

    # Step 7: Copy other files
    copy_other_files()

    # Step 8: Update config
    update_config(num_chunks)

    # Step 9: Verify
    if not verify(num_chunks, total_size):
        print("\nVERIFICATION FAILED!")
        sys.exit(1)

    print(f"\n{'=' * 60}")
    print(f"Split model ready at: {OUTPUT_DIR}")
    print(f"\nTo upload:")
    print(f"  huggingface-cli upload {REPO_ID} {OUTPUT_DIR} . --repo-type model")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
