#!/usr/bin/env python3
"""Character Error Rate (CER) utility -- Levenshtein distance / len(reference).
No external dependencies (works without network access to pypi mirrors for jiwer etc).

Usage as a library: from cer import cer
Usage as a script:  python3 cer.py "<reference text>" "<hypothesis text>"
"""
import sys


def levenshtein(a, b):
    if a == b:
        return 0
    la, lb = len(a), len(b)
    if la == 0:
        return lb
    if lb == 0:
        return la
    prev = list(range(lb + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * lb
        for j, cb in enumerate(b, 1):
            cost = 0 if ca == cb else 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
        prev = cur
    return prev[lb]


def cer(reference, hypothesis):
    """Character-level error rate. reference/hypothesis: strings (whitespace kept)."""
    ref = reference.strip()
    hyp = hypothesis.strip()
    if len(ref) == 0:
        return float("nan") if len(hyp) == 0 else 1.0
    return levenshtein(ref, hyp) / len(ref)


def wer(reference, hypothesis):
    """Word-level error rate (Levenshtein over whitespace-split tokens).
    Note: for Korean, word-level WER is a much weaker signal than CER (Korean
    words/josa often glue together differently across transcribers) -- CER is
    the primary metric for this project, WER is reported as a secondary one."""
    ref_tokens = reference.strip().split()
    hyp_tokens = hypothesis.strip().split()
    if len(ref_tokens) == 0:
        return float("nan") if len(hyp_tokens) == 0 else 1.0
    # reuse levenshtein but over token lists instead of char strings
    la, lb = len(ref_tokens), len(hyp_tokens)
    prev = list(range(lb + 1))
    for i, ta in enumerate(ref_tokens, 1):
        cur = [i] + [0] * lb
        for j, tb in enumerate(hyp_tokens, 1):
            cost = 0 if ta == tb else 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
        prev = cur
    return prev[lb] / la


if __name__ == "__main__":
    ref, hyp = sys.argv[1], sys.argv[2]
    print(f"CER: {cer(ref, hyp):.4f}")
    print(f"WER: {wer(ref, hyp):.4f}")
