#!/usr/bin/env python3
"""
Prepare Evaluation Set for TranslateGemma Quantization Benchmarking

Creates a multilingual test set for BLEU score evaluation.
Uses FLORES-200 benchmark data or generates synthetic test cases.

Usage:
    python prepare_eval_set.py \
        --languages en zh es fr de ja ko ar hi ru \
        --samples_per_lang 100 \
        --output eval/translate_gemma_test_suite.json

Requirements:
    pip install datasets
"""

import argparse
import json
import os
import random
from datetime import datetime
from typing import Dict, List, Optional, Tuple

# Sample multilingual test data
SAMPLE_TRANSLATIONS = {
    "en_zh": [
        {
            "source": "Hello, how are you today?",
            "reference": "你好，你今天好吗？",
        },
        {
            "source": "The weather is beautiful this morning.",
            "reference": "今天早上天气很好。",
        },
        {
            "source": "I would like to order a coffee, please.",
            "reference": "我想要一杯咖啡，请。",
        },
        {
            "source": "Where is the nearest train station?",
            "reference": "最近的火车站在哪里？",
        },
        {
            "source": "Thank you for your help yesterday.",
            "reference": "感谢你昨天的帮助。",
        },
    ],
    "en_es": [
        {
            "source": "Good morning, how are you?",
            "reference": "Buenos días, ¿cómo estás?",
        },
        {
            "source": "The water is cold in December.",
            "reference": "El agua está fría en diciembre.",
        },
        {
            "source": "Can you help me with this translation?",
            "reference": "¿Puedes ayudarme con esta traducción?",
        },
        {
            "source": "I like to read books in the library.",
            "reference": "Me gusta leer libros en la biblioteca.",
        },
        {
            "source": "The restaurant serves excellent food.",
            "reference": "El restaurante sirve comida excelente.",
        },
    ],
    "en_fr": [
        {
            "source": "Bonjour, comment allez-vous?",
            "reference": "Hello, how are you?",
        },
        {
            "source": "The Eiffel Tower is very beautiful.",
            "reference": "La Tour Eiffel est très belle.",
        },
        {
            "source": "Can you recommend a good restaurant?",
            "reference": "Pouvez-vous recommander un bon restaurant?",
        },
        {
            "source": "I am learning French language.",
            "reference": "J'apprends la langue française.",
        },
        {
            "source": "What time does the museum close?",
            "reference": "À quelle heure le musée ferme-t-il?",
        },
    ],
    "en_de": [
        {
            "source": "Good day, how are you?",
            "reference": "Guten Tag, wie geht es dir?",
        },
        {
            "source": "The coffee here is very good.",
            "reference": "Der Kaffee hier ist sehr gut.",
        },
        {
            "source": "Where is the bathroom?",
            "reference": "Wo ist das Badezimmer?",
        },
        {
            "source": "I work in Berlin for a technology company.",
            "reference": "Ich arbeite in Berlin für ein Technologieunternehmen.",
        },
        {
            "source": "Do you speak English?",
            "reference": "Sprichst du Englisch?",
        },
    ],
    "en_ja": [
        {
            "source": "Hello, what is your name?",
            "reference": "こんにちは、あなたの名前は何ですか？",
        },
        {
            "source": "This meal is delicious.",
            "reference": "この食事はおいしいです。",
        },
        {
            "source": "I work as a software engineer.",
            "reference": "私はソフトウェアエンジニアとして働いています。",
        },
        {
            "source": "Japan has many beautiful mountains.",
            "reference": "日本には多くの美しい山があります。",
        },
        {
            "source": "What time is the train?",
            "reference": "電車は何時ですか？",
        },
    ],
    "en_ko": [
        {
            "source": "Hello, nice to meet you.",
            "reference": "안녕하세요, 만나서 반갑습니다.",
        },
        {
            "source": "Korean food is very tasty.",
            "reference": "한국 음식은 매우 맛있습니다.",
        },
        {
            "source": "I am studying Korean language.",
            "reference": "저는 한국어를 공부하고 있습니다.",
        },
        {
            "source": "Seoul is a vibrant and modern city.",
            "reference": "서울은 활기차고 현대적인 도시입니다.",
        },
        {
            "source": "How much does this cost?",
            "reference": "이것은 얼마예요?",
        },
    ],
}


def load_flores200_data(languages: List[str]) -> Dict[str, List[Dict]]:
    """
    Load FLORES-200 benchmark data.
    Requires: pip install datasets

    FLORES-200 has 1000 parallel sentences for each language pair.
    """
    try:
        from datasets import load_dataset

        print("Loading FLORES-200 dataset...")

        # FLORES-200 typically has splits: dev, devtest
        try:
            data = load_dataset("facebook/flores", "all")
        except Exception as e:
            print(f"⚠️  Could not load FLORES-200: {e}")
            return {}

        print(f"✅ FLORES-200 loaded")
        return data

    except ImportError:
        print("⚠️  datasets library not installed")
        print("   Install with: pip install datasets")
        return {}


def create_synthetic_test_set(
    languages: List[str], samples_per_lang: int
) -> List[Dict]:
    """
    Create synthetic test set using available sample translations.

    Falls back to creating basic test cases if limited data available.
    """
    test_set = []
    sample_id = 0

    # Generate language pair combinations
    lang_pairs = []
    for src_lang in languages:
        for tgt_lang in languages:
            if src_lang != tgt_lang:
                lang_pairs.append((src_lang, tgt_lang))

    print(f"Creating test set for {len(lang_pairs)} language pairs...")

    for src_lang, tgt_lang in lang_pairs:
        pair_key = f"{src_lang}_{tgt_lang}"
        reverse_key = f"{tgt_lang}_{src_lang}"

        # Get sample data
        samples = SAMPLE_TRANSLATIONS.get(pair_key, [])
        if not samples and reverse_key in SAMPLE_TRANSLATIONS:
            # Swap source/reference
            orig_samples = SAMPLE_TRANSLATIONS[reverse_key]
            samples = [
                {"source": s["reference"], "reference": s["source"]}
                for s in orig_samples
            ]

        # Duplicate samples to reach target count
        if samples:
            while len(samples) < samples_per_lang:
                samples.extend(samples[: samples_per_lang - len(samples)])

        # Add to test set
        for i, sample in enumerate(samples[:samples_per_lang]):
            test_set.append(
                {
                    "id": sample_id,
                    "source_lang": src_lang,
                    "target_lang": tgt_lang,
                    "source": sample.get("source", ""),
                    "reference": sample.get("reference", ""),
                }
            )
            sample_id += 1

        print(f"  ✓ {pair_key}: {len(samples[:samples_per_lang])} samples")

    return test_set


def create_advanced_test_cases() -> List[Dict]:
    """
    Create test cases for edge cases and specific translation challenges.
    """
    edge_cases = [
        # Empty strings
        {"source": "", "reference": "", "description": "empty_string"},
        # Numbers only
        {"source": "123", "reference": "123", "description": "numbers_only"},
        # Punctuation
        {
            "source": "Hello, world! How are you?",
            "reference": "Hello, world! How are you?",
            "description": "punctuation",
        },
        # URLs/emails (shouldn't translate)
        {
            "source": "Email me at test@example.com",
            "reference": "Email me at test@example.com",
            "description": "email_address",
        },
        # Code snippets
        {
            "source": "def hello(): print('world')",
            "reference": "def hello(): print('world')",
            "description": "code_snippet",
        },
    ]

    return edge_cases


def main():
    parser = argparse.ArgumentParser(
        description="Prepare evaluation set for TranslateGemma benchmarking",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Create basic test set
  python prepare_eval_set.py

  # Create large test set for specific languages
  python prepare_eval_set.py \
      --languages en zh es fr de ja ko \
      --samples_per_lang 200 \
      --output eval/large_test_suite.json

  # Use FLORES-200 dataset (requires datasets library)
  python prepare_eval_set.py --use_flores --samples_per_lang 100
        """,
    )

    parser.add_argument(
        "--languages",
        nargs="+",
        default=["en", "zh", "es", "fr", "de", "ja", "ko", "ar", "hi", "ru"],
        help="Language codes to include in test set",
    )
    parser.add_argument(
        "--samples_per_lang",
        type=int,
        default=50,
        help="Number of samples per language pair",
    )
    parser.add_argument(
        "--output",
        default="./eval/translate_gemma_test_suite.json",
        help="Output file path",
    )
    parser.add_argument(
        "--use_flores",
        action="store_true",
        help="Use FLORES-200 dataset (if available)",
    )
    parser.add_argument(
        "--include_edge_cases",
        action="store_true",
        help="Include edge case test samples",
    )

    args = parser.parse_args()

    print(f"{'='*60}")
    print(f"  Preparing TranslateGemma Evaluation Set")
    print(f"{'='*60}\n")

    # Create output directory
    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)

    # Load data
    test_set = []

    if args.use_flores:
        flores_data = load_flores200_data(args.languages)
        if flores_data:
            # Process FLORES data (simplified)
            print("⚠️  FLORES-200 processing not fully implemented")
            print("   Using synthetic data instead")

    # Create synthetic test set
    test_set = create_synthetic_test_set(args.languages, args.samples_per_lang)

    # Add edge cases if requested
    if args.include_edge_cases:
        edge_cases = create_advanced_test_cases()
        print(f"\nAdding {len(edge_cases)} edge case samples...")
        for i, case in enumerate(edge_cases):
            test_set.append(
                {
                    "id": len(test_set),
                    "source_lang": "en",
                    "target_lang": "en",
                    "source": case.get("source", ""),
                    "reference": case.get("reference", ""),
                    "description": case.get("description", ""),
                }
            )

    # Save test set
    output_data = {
        "metadata": {
            "created": datetime.now().isoformat(),
            "languages": args.languages,
            "samples_per_language_pair": args.samples_per_lang,
            "total_samples": len(test_set),
            "include_edge_cases": args.include_edge_cases,
        },
        "samples": test_set,
    }

    with open(args.output, "w") as f:
        json.dump(output_data, f, indent=2)

    print(f"\n{'='*60}")
    print(f"✅ Evaluation set created successfully")
    print(f"{'='*60}")
    print(f"Output: {args.output}")
    print(f"Total samples: {len(test_set)}")
    print(f"Languages: {', '.join(args.languages)}")
    print(f"Language pairs: {len(args.languages) * (len(args.languages) - 1)}")

    # Summary statistics
    pair_counts = {}
    for sample in test_set:
        pair = f"{sample['source_lang']}→{sample['target_lang']}"
        pair_counts[pair] = pair_counts.get(pair, 0) + 1

    print(f"\nSample distribution:")
    for pair, count in sorted(pair_counts.items())[:5]:
        print(f"  {pair}: {count}")
    if len(pair_counts) > 5:
        print(f"  ... and {len(pair_counts) - 5} more")


if __name__ == "__main__":
    main()
