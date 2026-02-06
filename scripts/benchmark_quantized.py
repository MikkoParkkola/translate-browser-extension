#!/usr/bin/env python3
"""
Benchmark Quantized TranslateGemma Model

Evaluates translation quality (BLEU scores) of quantized models
compared to baseline FP32/FP16 versions.

Usage:
    # Evaluate quantized model
    python benchmark_quantized.py \
        --model ./models/translate-gemma-4b-q4 \
        --baseline google/translate-gemma-4b \
        --test_set eval/translate_gemma_test_suite.json \
        --output_dir ./eval/q4_results

    # Compare two models
    python benchmark_quantized.py \
        --model ./models/translate-gemma-4b-q4 \
        --compare_model ./models/translate-gemma-4b-q3 \
        --test_set eval/translate_gemma_test_suite.json \
        --output_dir ./eval/comparison

Requirements:
    pip install transformers torch sacrebleu evaluate datasets
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import torch
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer


class TranslationBenchmark:
    """Benchmark translation quality and performance."""

    def __init__(self, model_path: str, device: str = "cuda:0"):
        """Initialize with model and tokenizer."""
        self.device = device
        self.model_path = model_path

        print(f"Loading model from {model_path}...")
        self.tokenizer = AutoTokenizer.from_pretrained(model_path)
        self.model = AutoModelForSeq2SeqLM.from_pretrained(
            model_path,
            torch_dtype=torch.float16 if device.startswith("cuda") else torch.float32,
            device_map=device,
        )
        self.model.eval()

        # Get model size
        self.model_size_gb = sum(p.numel() for p in self.model.parameters()) * 2 / (
            1024**3
        )
        print(f"✅ Model loaded ({self.model_size_gb:.2f} GB)")

    def translate(
        self, text: str, source_lang: str, target_lang: str, max_length: int = 512
    ) -> str:
        """Translate text from source to target language."""
        # Prepare input with language tags if needed
        inputs = self.tokenizer(
            text, return_tensors="pt", max_length=512, truncation=True
        ).to(self.device)

        with torch.no_grad():
            outputs = self.model.generate(
                **inputs,
                max_length=max_length,
                num_beams=4,
                early_stopping=True,
            )

        return self.tokenizer.decode(outputs[0], skip_special_tokens=True)

    def batch_translate(
        self,
        texts: List[str],
        source_lang: str,
        target_lang: str,
        batch_size: int = 8,
    ) -> List[str]:
        """Translate multiple texts in batches."""
        results = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            for text in batch:
                try:
                    result = self.translate(text, source_lang, target_lang)
                    results.append(result)
                except Exception as e:
                    print(f"⚠️  Error translating '{text[:50]}': {e}")
                    results.append("")

        return results


def compute_bleu_score(references: List[str], predictions: List[str]) -> float:
    """Compute BLEU score using sacrebleu."""
    try:
        from sacrebleu import corpus_bleu

        # Format for sacrebleu
        refs = [[ref] for ref in references]
        bleu = corpus_bleu(predictions, refs)
        return bleu.score / 100.0  # Normalize to 0-1
    except ImportError:
        print("⚠️  sacrebleu not installed, using approximate score")
        # Fallback: simple word overlap
        correct = sum(
            1
            for ref, pred in zip(references, predictions)
            if ref.lower().strip() == pred.lower().strip()
        )
        return correct / len(references) if references else 0.0


def load_test_set(test_file: str) -> List[Dict[str, Any]]:
    """Load test dataset from JSON file."""
    with open(test_file, "r") as f:
        data = json.load(f)

    if isinstance(data, dict):
        # Assume it has 'samples' or similar key
        return data.get("samples", [])
    else:
        return data


def evaluate_model(
    model: TranslationBenchmark,
    test_set: List[Dict[str, Any]],
    languages: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Evaluate model on test set."""
    results = {
        "model_size_gb": model.model_size_gb,
        "timestamp": datetime.now().isoformat(),
        "language_pairs": {},
        "overall_metrics": {},
    }

    # Group by language pair
    pairs = {}
    for sample in test_set:
        pair = (sample.get("source_lang", "en"), sample.get("target_lang", "en"))
        if languages and pair[0] not in languages and pair[1] not in languages:
            continue

        if pair not in pairs:
            pairs[pair] = []
        pairs[pair].append(sample)

    print(f"\nEvaluating {len(pairs)} language pairs...")

    for (src_lang, tgt_lang), samples in pairs.items():
        pair_name = f"{src_lang}→{tgt_lang}"
        print(f"\n[{pair_name}] Evaluating {len(samples)} samples...")

        # Translate all samples
        sources = [s.get("source", "") for s in samples]
        references = [s.get("reference", "") for s in samples]

        print(f"  Translating {len(sources)} sentences...")
        start_time = time.time()
        predictions = model.batch_translate(sources, src_lang, tgt_lang)
        elapsed = time.time() - start_time

        # Compute BLEU
        bleu = compute_bleu_score(references, predictions)
        avg_latency = (elapsed * 1000) / len(sources) if sources else 0

        results["language_pairs"][pair_name] = {
            "num_samples": len(samples),
            "bleu_score": bleu,
            "avg_latency_ms": avg_latency,
            "total_time_s": elapsed,
            "sample_predictions": [
                {
                    "source": src,
                    "reference": ref,
                    "prediction": pred,
                }
                for src, ref, pred in zip(sources[:3], references[:3], predictions[:3])
            ],
        }

        print(f"  ✅ BLEU: {bleu:.4f}")
        print(f"  ✅ Latency: {avg_latency:.1f}ms/sentence")

    # Compute overall metrics
    all_bleus = [m["bleu_score"] for m in results["language_pairs"].values()]
    results["overall_metrics"]["mean_bleu"] = sum(all_bleus) / len(all_bleus)
    results["overall_metrics"]["num_language_pairs"] = len(all_bleus)

    return results


def compare_results(baseline: Dict[str, Any], quantized: Dict[str, Any]) -> Dict[str, Any]:
    """Compare baseline and quantized results."""
    comparison = {
        "baseline_model_size_gb": baseline.get("model_size_gb"),
        "quantized_model_size_gb": quantized.get("model_size_gb"),
        "compression_ratio": baseline.get("model_size_gb", 1) / quantized.get("model_size_gb", 1),
        "language_pair_comparisons": {},
    }

    baseline_pairs = baseline.get("language_pairs", {})
    quantized_pairs = quantized.get("language_pairs", {})

    for pair_name in baseline_pairs.keys():
        if pair_name in quantized_pairs:
            baseline_bleu = baseline_pairs[pair_name]["bleu_score"]
            quantized_bleu = quantized_pairs[pair_name]["bleu_score"]
            bleu_delta = (quantized_bleu - baseline_bleu) * 100  # percentage points

            comparison["language_pair_comparisons"][pair_name] = {
                "baseline_bleu": baseline_bleu,
                "quantized_bleu": quantized_bleu,
                "bleu_delta_percent": bleu_delta,
                "bleu_delta_acceptable": abs(bleu_delta) < 2.0,  # <2% threshold
            }

    # Overall comparison
    baseline_overall = baseline.get("overall_metrics", {})
    quantized_overall = quantized.get("overall_metrics", {})
    overall_delta = (
        quantized_overall.get("mean_bleu", 0) - baseline_overall.get("mean_bleu", 0)
    ) * 100

    comparison["overall_comparison"] = {
        "baseline_mean_bleu": baseline_overall.get("mean_bleu"),
        "quantized_mean_bleu": quantized_overall.get("mean_bleu"),
        "mean_bleu_delta_percent": overall_delta,
        "acceptable": abs(overall_delta) < 2.0,
    }

    return comparison


def main():
    parser = argparse.ArgumentParser(
        description="Benchmark TranslateGemma quantized models",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Benchmark quantized model
  python benchmark_quantized.py --model ./models/translate-gemma-4b-q4

  # Compare with baseline
  python benchmark_quantized.py \
      --model ./models/translate-gemma-4b-q4 \
      --baseline google/translate-gemma-4b

  # Benchmark specific languages
  python benchmark_quantized.py \
      --model ./models/translate-gemma-4b-q4 \
      --languages en zh es fr de
        """,
    )

    parser.add_argument(
        "--model",
        required=True,
        help="Path or model ID for quantized model",
    )
    parser.add_argument(
        "--baseline",
        help="Path or model ID for baseline model (for comparison)",
    )
    parser.add_argument(
        "--test_set",
        default="./eval/translate_gemma_test_suite.json",
        help="Path to test set JSON file",
    )
    parser.add_argument(
        "--output_dir",
        default="./eval/results",
        help="Output directory for results",
    )
    parser.add_argument(
        "--languages",
        nargs="+",
        help="Filter to specific languages (e.g., en zh es)",
    )
    parser.add_argument(
        "--device",
        default="cuda:0",
        help="Device for inference",
    )
    parser.add_argument(
        "--batch_size",
        type=int,
        default=8,
        help="Batch size for translation",
    )

    args = parser.parse_args()

    # Create output directory
    os.makedirs(args.output_dir, exist_ok=True)

    print(f"{'='*60}")
    print(f"  TranslateGemma Quantization Benchmark")
    print(f"{'='*60}\n")

    # Check test set exists
    if not os.path.exists(args.test_set):
        print(f"❌ Test set not found: {args.test_set}")
        print(f"Create test set first with: python prepare_eval_set.py")
        sys.exit(1)

    test_set = load_test_set(args.test_set)
    print(f"✅ Loaded test set with {len(test_set)} samples")

    # Evaluate quantized model
    print(f"\n{'='*60}")
    print(f"Evaluating Quantized Model")
    print(f"{'='*60}")

    quantized_model = TranslationBenchmark(args.model, device=args.device)
    quantized_results = evaluate_model(
        quantized_model, test_set, languages=args.languages
    )

    # Save quantized results
    quantized_file = os.path.join(args.output_dir, "quantized_results.json")
    with open(quantized_file, "w") as f:
        json.dump(quantized_results, f, indent=2)
    print(f"\n✅ Saved quantized results to {quantized_file}")

    # Evaluate baseline if provided
    if args.baseline:
        print(f"\n{'='*60}")
        print(f"Evaluating Baseline Model")
        print(f"{'='*60}")

        baseline_model = TranslationBenchmark(args.baseline, device=args.device)
        baseline_results = evaluate_model(
            baseline_model, test_set, languages=args.languages
        )

        # Save baseline results
        baseline_file = os.path.join(args.output_dir, "baseline_results.json")
        with open(baseline_file, "w") as f:
            json.dump(baseline_results, f, indent=2)
        print(f"\n✅ Saved baseline results to {baseline_file}")

        # Compare
        print(f"\n{'='*60}")
        print(f"Comparison: Baseline vs Quantized")
        print(f"{'='*60}\n")

        comparison = compare_results(baseline_results, quantized_results)

        # Print comparison summary
        overall = comparison["overall_comparison"]
        print(f"Compression Ratio: {comparison['compression_ratio']:.1f}×")
        print(f"  Baseline: {comparison['baseline_model_size_gb']:.1f} GB")
        print(f"  Quantized: {comparison['quantized_model_size_gb']:.1f} GB")
        print(f"\nQuality Comparison:")
        print(f"  Baseline Mean BLEU: {overall['baseline_mean_bleu']:.4f}")
        print(f"  Quantized Mean BLEU: {overall['quantized_mean_bleu']:.4f}")
        print(f"  Delta: {overall['mean_bleu_delta_percent']:.2f}%")
        print(f"  Acceptable (<2%): {'✅ YES' if overall['acceptable'] else '❌ NO'}")

        print(f"\nPer-language-pair results:")
        for pair_name, metrics in comparison["language_pair_comparisons"].items():
            status = "✅" if metrics["bleu_delta_acceptable"] else "❌"
            print(
                f"  {status} {pair_name}: {metrics['bleu_delta_percent']:+.2f}% "
                f"({metrics['baseline_bleu']:.4f} → {metrics['quantized_bleu']:.4f})"
            )

        # Save comparison
        comparison_file = os.path.join(args.output_dir, "comparison.json")
        with open(comparison_file, "w") as f:
            json.dump(comparison, f, indent=2)
        print(f"\n✅ Saved comparison to {comparison_file}")

    print(f"\n{'='*60}")
    print(f"Results saved to: {args.output_dir}")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
