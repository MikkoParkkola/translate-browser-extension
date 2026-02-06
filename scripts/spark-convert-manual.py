#!/usr/bin/env python3
"""
Manual ONNX export for TranslateGemma-4B with vision encoder.
Uses component-by-component export similar to PaliGemma/Gemma3n.
"""
import os
import sys
import torch
import onnx
from pathlib import Path

# Configuration
MODEL_ID = "google/translategemma-4b-it"
OUTPUT_DIR = Path("/output/translategemma-onnx")
OPSET_VERSION = 17

def export_vision_encoder(model, processor, output_dir):
    """Export the SigLIP vision encoder separately."""
    print("Exporting vision encoder...")

    vision_encoder = model.vision_tower
    vision_encoder.eval()

    # Create dummy image input
    dummy_pixel_values = torch.randn(1, 3, 224, 224, device=model.device, dtype=torch.float16)

    output_path = output_dir / "onnx" / "vision_encoder.onnx"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with torch.no_grad():
        torch.onnx.export(
            vision_encoder,
            (dummy_pixel_values,),
            str(output_path),
            input_names=["pixel_values"],
            output_names=["image_features"],
            dynamic_axes={
                "pixel_values": {0: "batch_size"},
                "image_features": {0: "batch_size"},
            },
            opset_version=OPSET_VERSION,
            do_constant_folding=True,
        )

    print(f"Vision encoder exported to {output_path}")
    return output_path


def export_text_embeddings(model, output_dir):
    """Export the embedding layer."""
    print("Exporting embedding layer...")

    embed_tokens = model.language_model.model.embed_tokens

    output_path = output_dir / "onnx" / "embed_tokens.onnx"

    dummy_input_ids = torch.tensor([[1, 2, 3]], dtype=torch.long, device=model.device)

    # Create wrapper for just embeddings
    class EmbedWrapper(torch.nn.Module):
        def __init__(self, embed):
            super().__init__()
            self.embed = embed

        def forward(self, input_ids):
            return self.embed(input_ids)

    wrapper = EmbedWrapper(embed_tokens)
    wrapper.eval()

    with torch.no_grad():
        torch.onnx.export(
            wrapper,
            (dummy_input_ids,),
            str(output_path),
            input_names=["input_ids"],
            output_names=["inputs_embeds"],
            dynamic_axes={
                "input_ids": {0: "batch_size", 1: "sequence_length"},
                "inputs_embeds": {0: "batch_size", 1: "sequence_length"},
            },
            opset_version=OPSET_VERSION,
            do_constant_folding=True,
        )

    print(f"Embeddings exported to {output_path}")
    return output_path


def export_decoder(model, output_dir):
    """Export the language model decoder."""
    print("Exporting decoder model...")

    lm = model.language_model
    lm.eval()

    output_path = output_dir / "onnx" / "decoder_model_merged.onnx"

    # Dummy inputs matching expected shapes
    batch_size = 1
    seq_len = 10
    hidden_size = model.config.text_config.hidden_size

    dummy_inputs_embeds = torch.randn(
        batch_size, seq_len, hidden_size,
        device=model.device,
        dtype=torch.float16
    )
    dummy_attention_mask = torch.ones(batch_size, seq_len, device=model.device, dtype=torch.long)

    # Export with dynamic axes
    with torch.no_grad():
        torch.onnx.export(
            lm,
            (None, dummy_attention_mask, None, dummy_inputs_embeds),  # input_ids, attention_mask, position_ids, inputs_embeds
            str(output_path),
            input_names=["attention_mask", "inputs_embeds"],
            output_names=["logits"],
            dynamic_axes={
                "attention_mask": {0: "batch_size", 1: "sequence_length"},
                "inputs_embeds": {0: "batch_size", 1: "sequence_length"},
                "logits": {0: "batch_size", 1: "sequence_length"},
            },
            opset_version=OPSET_VERSION,
            do_constant_folding=True,
        )

    print(f"Decoder exported to {output_path}")
    return output_path


def main():
    print(f"Loading model: {MODEL_ID}")

    from transformers import AutoProcessor, AutoModelForImageTextToText

    # Load model
    processor = AutoProcessor.from_pretrained(MODEL_ID, trust_remote_code=True)
    model = AutoModelForImageTextToText.from_pretrained(
        MODEL_ID,
        torch_dtype=torch.float16,
        device_map="cuda",
        trust_remote_code=True,
    )
    model.eval()

    print(f"Model loaded. Config: {model.config.model_type}")
    print(f"Vision config: {model.config.vision_config}")
    print(f"Text config: {model.config.text_config}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Export components
    try:
        export_vision_encoder(model, processor, OUTPUT_DIR)
    except Exception as e:
        print(f"Vision encoder export failed: {e}")

    try:
        export_text_embeddings(model, OUTPUT_DIR)
    except Exception as e:
        print(f"Embeddings export failed: {e}")

    try:
        export_decoder(model, OUTPUT_DIR)
    except Exception as e:
        print(f"Decoder export failed: {e}")

    # Copy config files
    processor.save_pretrained(str(OUTPUT_DIR))
    model.config.save_pretrained(str(OUTPUT_DIR))

    print(f"\nExport complete! Files in {OUTPUT_DIR}")
    for f in OUTPUT_DIR.rglob("*"):
        if f.is_file():
            size_mb = f.stat().st_size / (1024 * 1024)
            print(f"  {f.relative_to(OUTPUT_DIR)}: {size_mb:.1f} MB")


if __name__ == "__main__":
    main()
