#!/usr/bin/env python3
"""
Manual ONNX export for TranslateGemma-4B - Direct on DGX Spark
Exports components separately like PaliGemma/Gemma3n.
"""
import os
import sys
import json
import torch
from pathlib import Path

# Ensure CUDA is available
print(f"CUDA available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"CUDA device: {torch.cuda.get_device_name(0)}")

from transformers import AutoProcessor, AutoModelForImageTextToText, AutoConfig

MODEL_ID = "google/translategemma-4b-it"
OUTPUT_DIR = Path("/tmp/translategemma-onnx")
OPSET_VERSION = 17

print(f"Loading model: {MODEL_ID}")

# Load config first
config = AutoConfig.from_pretrained(MODEL_ID, trust_remote_code=True)
print(f"Model type: {config.model_type}")
print(f"Vision config type: {config.vision_config.model_type}")

# Load processor
print("Loading processor...")
processor = AutoProcessor.from_pretrained(MODEL_ID, trust_remote_code=True)

# Load model in fp16
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

# Check deeper structure
print("\n=== Model.model Components ===")
if hasattr(model, 'model'):
    for name, module in model.model.named_children():
        print(f"  model.{name}: {type(module).__name__}")

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
onnx_dir = OUTPUT_DIR / "onnx"
onnx_dir.mkdir(exist_ok=True)

# 1. Export Vision Encoder (SigLIP)
print("\n=== Exporting Vision Encoder ===")
try:
    # Find vision tower in the model structure
    if hasattr(model, 'vision_tower'):
        vision_tower = model.vision_tower
    elif hasattr(model, 'model') and hasattr(model.model, 'vision_tower'):
        vision_tower = model.model.vision_tower
    else:
        raise AttributeError("Cannot find vision_tower")
    vision_tower.eval()

    vision_config = config.vision_config
    image_size = getattr(vision_config, 'image_size', 224)

    print(f"Vision encoder: {type(vision_tower).__name__}")
    print(f"Image size: {image_size}")

    dummy_pixel_values = torch.randn(
        1, 3, image_size, image_size,
        device="cuda:0",
        dtype=torch.float16
    )

    class VisionEncoderWrapper(torch.nn.Module):
        def __init__(self, vision_tower):
            super().__init__()
            self.vision_tower = vision_tower

        def forward(self, pixel_values):
            outputs = self.vision_tower(pixel_values)
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
    # Find embed_tokens in the model structure
    embed_tokens = None
    if hasattr(model, 'model') and hasattr(model.model, 'embed_tokens'):
        embed_tokens = model.model.embed_tokens
    elif hasattr(model, 'language_model'):
        lm = model.language_model
        if hasattr(lm, 'model') and hasattr(lm.model, 'embed_tokens'):
            embed_tokens = lm.model.embed_tokens
        elif hasattr(lm, 'embed_tokens'):
            embed_tokens = lm.embed_tokens
    if embed_tokens is None:
        raise AttributeError("Cannot find embed_tokens")

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

# 3. Export Text Decoder (using inputs_embeds)
print("\n=== Exporting Text Decoder ===")
try:
    # For Gemma3ForConditionalGeneration, we export with inputs_embeds to allow
    # feeding vision features + text embeddings combined
    hidden_size = config.text_config.hidden_size if hasattr(config, 'text_config') else 2560
    print(f"Hidden size: {hidden_size}")

    class TextDecoderWrapper(torch.nn.Module):
        def __init__(self, full_model):
            super().__init__()
            self.model = full_model.model  # The Gemma3Model
            self.lm_head = full_model.lm_head

        def forward(self, inputs_embeds, attention_mask):
            # Run through the transformer layers
            outputs = self.model(
                input_ids=None,
                inputs_embeds=inputs_embeds,
                attention_mask=attention_mask,
                use_cache=False,
                return_dict=True,
            )
            # Apply language model head
            logits = self.lm_head(outputs.last_hidden_state)
            return logits

    wrapper = TextDecoderWrapper(model)
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

    print(f"Exporting decoder with hidden_size={hidden_size}...")

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

except Exception as e:
    print(f"Decoder export failed: {e}")
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
