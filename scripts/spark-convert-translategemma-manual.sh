#!/bin/bash
# Manual ONNX export for TranslateGemma-4B with vision encoder
# Exports components separately like PaliGemma/Gemma3n
set -e

OUTPUT_DIR="/output/translategemma-onnx"
MODEL_ID="google/translategemma-4b-it"

# HuggingFace auth from mounted cache
export HF_HOME=/hf_cache
export HUGGINGFACE_HUB_CACHE=/hf_cache

echo "=== Installing dependencies ==="
pip3 install --quiet --upgrade transformers accelerate onnx onnxscript onnxruntime sentencepiece protobuf optimum

echo "=== Starting manual ONNX export ==="
python3 << 'PYTHON_SCRIPT'
import os
import sys
import json
import torch
import onnx
from pathlib import Path
from transformers import AutoProcessor, AutoModelForImageTextToText, AutoConfig

MODEL_ID = "google/translategemma-4b-it"
OUTPUT_DIR = Path("/output/translategemma-onnx")
OPSET_VERSION = 17

print(f"Loading model: {MODEL_ID}")

# Load config first to understand structure
config = AutoConfig.from_pretrained(MODEL_ID, trust_remote_code=True)
print(f"Model type: {config.model_type}")
print(f"Vision config type: {config.vision_config.model_type if hasattr(config, 'vision_config') else 'N/A'}")
print(f"Text config: {config.text_config if hasattr(config, 'text_config') else 'N/A'}")

# Load processor
print("Loading processor...")
processor = AutoProcessor.from_pretrained(MODEL_ID, trust_remote_code=True)

# Load model in fp16 for ONNX export
print("Loading model (this may take a while)...")
model = AutoModelForImageTextToText.from_pretrained(
    MODEL_ID,
    torch_dtype=torch.float16,
    device_map="cuda:0",
    trust_remote_code=True,
)
model.eval()

print(f"Model loaded on device: {model.device}")
print(f"Model structure: {type(model).__name__}")

# Inspect model components
print("\n=== Model Components ===")
for name, module in model.named_children():
    print(f"  {name}: {type(module).__name__}")

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
onnx_dir = OUTPUT_DIR / "onnx"
onnx_dir.mkdir(exist_ok=True)

# 1. Export Vision Encoder (SigLIP)
print("\n=== Exporting Vision Encoder ===")
try:
    vision_tower = model.vision_tower
    vision_tower.eval()

    # Get vision config
    vision_config = config.vision_config
    image_size = getattr(vision_config, 'image_size', 224)

    print(f"Vision encoder: {type(vision_tower).__name__}")
    print(f"Image size: {image_size}")

    # Create dummy input
    dummy_pixel_values = torch.randn(
        1, 3, image_size, image_size,
        device="cuda:0",
        dtype=torch.float16
    )

    # Trace vision encoder
    class VisionEncoderWrapper(torch.nn.Module):
        def __init__(self, vision_tower):
            super().__init__()
            self.vision_tower = vision_tower

        def forward(self, pixel_values):
            outputs = self.vision_tower(pixel_values)
            # Return last hidden state
            if hasattr(outputs, 'last_hidden_state'):
                return outputs.last_hidden_state
            return outputs[0] if isinstance(outputs, tuple) else outputs

    wrapper = VisionEncoderWrapper(vision_tower)
    wrapper.eval()

    vision_path = onnx_dir / "vision_encoder.onnx"

    with torch.no_grad():
        torch.onnx.export(
            wrapper,
            (dummy_pixel_values,),
            str(vision_path),
            input_names=["pixel_values"],
            output_names=["image_features"],
            dynamic_axes={
                "pixel_values": {0: "batch_size"},
                "image_features": {0: "batch_size", 1: "num_patches"},
            },
            opset_version=OPSET_VERSION,
            do_constant_folding=True,
        )

    size_mb = vision_path.stat().st_size / (1024 * 1024)
    print(f"Vision encoder exported: {vision_path} ({size_mb:.1f} MB)")

except Exception as e:
    print(f"Vision encoder export failed: {e}")
    import traceback
    traceback.print_exc()

# 2. Export Embedding Layer
print("\n=== Exporting Embedding Layer ===")
try:
    # Find the embedding layer in the language model
    if hasattr(model, 'language_model'):
        lm = model.language_model
        if hasattr(lm, 'model') and hasattr(lm.model, 'embed_tokens'):
            embed_tokens = lm.model.embed_tokens
        elif hasattr(lm, 'embed_tokens'):
            embed_tokens = lm.embed_tokens
        else:
            raise AttributeError("Cannot find embed_tokens in language model")
    else:
        raise AttributeError("Model has no language_model attribute")

    class EmbedWrapper(torch.nn.Module):
        def __init__(self, embed):
            super().__init__()
            self.embed = embed

        def forward(self, input_ids):
            return self.embed(input_ids)

    wrapper = EmbedWrapper(embed_tokens)
    wrapper.eval()

    dummy_input_ids = torch.tensor([[1, 2, 3]], dtype=torch.long, device="cuda:0")

    embed_path = onnx_dir / "embed_tokens.onnx"

    with torch.no_grad():
        torch.onnx.export(
            wrapper,
            (dummy_input_ids,),
            str(embed_path),
            input_names=["input_ids"],
            output_names=["inputs_embeds"],
            dynamic_axes={
                "input_ids": {0: "batch_size", 1: "sequence_length"},
                "inputs_embeds": {0: "batch_size", 1: "sequence_length"},
            },
            opset_version=OPSET_VERSION,
            do_constant_folding=True,
        )

    size_mb = embed_path.stat().st_size / (1024 * 1024)
    print(f"Embeddings exported: {embed_path} ({size_mb:.1f} MB)")

except Exception as e:
    print(f"Embeddings export failed: {e}")
    import traceback
    traceback.print_exc()

# 3. Export Full Model for Text Generation (merged decoder)
print("\n=== Exporting Decoder (merged) ===")
try:
    # For text generation, we need the full forward pass
    # This is complex for vision-language models, so let's try with optimum's approach

    from optimum.exporters.onnx import main_export

    # Try text-generation task (without vision)
    print("Attempting text-generation export via optimum...")
    text_output = OUTPUT_DIR / "text_only"
    text_output.mkdir(exist_ok=True)

    # This will export just the text generation part
    main_export(
        model_name_or_path=MODEL_ID,
        output=str(text_output),
        task="text-generation-with-past",
        device="cuda",
        fp16=True,
        trust_remote_code=True,
    )

    print(f"Text generation model exported to {text_output}")

    # Move the decoder to onnx folder
    for f in text_output.glob("*.onnx*"):
        dest = onnx_dir / f"decoder_{f.name}"
        f.rename(dest)
        print(f"  Moved: {dest.name}")

except Exception as e:
    print(f"Decoder export via optimum failed: {e}")
    print("Attempting manual decoder export...")

    try:
        # Manual decoder export
        lm = model.language_model
        lm.eval()

        # Create a wrapper that handles the forward pass
        class DecoderWrapper(torch.nn.Module):
            def __init__(self, lm, hidden_size):
                super().__init__()
                self.lm = lm
                self.hidden_size = hidden_size

            def forward(self, inputs_embeds, attention_mask):
                outputs = self.lm(
                    input_ids=None,
                    inputs_embeds=inputs_embeds,
                    attention_mask=attention_mask,
                    use_cache=False,
                )
                return outputs.logits

        hidden_size = config.text_config.hidden_size if hasattr(config, 'text_config') else config.hidden_size
        wrapper = DecoderWrapper(lm, hidden_size)
        wrapper.eval()

        batch_size = 1
        seq_len = 10

        dummy_embeds = torch.randn(
            batch_size, seq_len, hidden_size,
            device="cuda:0",
            dtype=torch.float16
        )
        dummy_mask = torch.ones(batch_size, seq_len, device="cuda:0", dtype=torch.long)

        decoder_path = onnx_dir / "decoder_model_merged.onnx"

        with torch.no_grad():
            torch.onnx.export(
                wrapper,
                (dummy_embeds, dummy_mask),
                str(decoder_path),
                input_names=["inputs_embeds", "attention_mask"],
                output_names=["logits"],
                dynamic_axes={
                    "inputs_embeds": {0: "batch_size", 1: "sequence_length"},
                    "attention_mask": {0: "batch_size", 1: "sequence_length"},
                    "logits": {0: "batch_size", 1: "sequence_length"},
                },
                opset_version=OPSET_VERSION,
                do_constant_folding=True,
            )

        size_mb = decoder_path.stat().st_size / (1024 * 1024)
        print(f"Decoder exported: {decoder_path} ({size_mb:.1f} MB)")

    except Exception as e2:
        print(f"Manual decoder export also failed: {e2}")
        import traceback
        traceback.print_exc()

# 4. Save config and tokenizer
print("\n=== Saving config and tokenizer ===")
processor.save_pretrained(str(OUTPUT_DIR))
config.save_pretrained(str(OUTPUT_DIR))

# Create transformers.js compatible config
tjsconfig = {
    "model_type": "translategemma",
    "architectures": ["TranslateGemmaForConditionalGeneration"],
    "components": {
        "vision_encoder": "onnx/vision_encoder.onnx",
        "embed_tokens": "onnx/embed_tokens.onnx",
        "decoder_model_merged": "onnx/decoder_model_merged.onnx"
    },
    "quantization_available": ["fp16", "q4", "q8"]
}

with open(OUTPUT_DIR / "transformers_js_config.json", "w") as f:
    json.dump(tjsconfig, f, indent=2)

print("\n=== Export Summary ===")
for f in sorted(OUTPUT_DIR.rglob("*.onnx*")):
    size_mb = f.stat().st_size / (1024 * 1024)
    print(f"  {f.relative_to(OUTPUT_DIR)}: {size_mb:.1f} MB")

print("\nDone!")
PYTHON_SCRIPT

echo "=== Final output ==="
ls -la "$OUTPUT_DIR/" 2>/dev/null || echo "Output directory check"
ls -la "$OUTPUT_DIR/onnx/" 2>/dev/null || echo "ONNX directory check"
