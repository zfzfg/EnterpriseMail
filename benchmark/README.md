# Isolated Phase 0/2 benchmark

This directory contains only the isolated benchmark overlay, configuration, and immutable synthetic fixtures. It does not change the development Compose project.

Run from the repository root:

```sh
# Offline validation; no Docker, mail account, or model is contacted.
python scripts/performance/run.py check --offline
python -m unittest discover -s scripts/performance/tests -t scripts/performance -v

# Validate the merged Compose model when Docker is available.
python scripts/performance/run.py check

# One candidate/scenario, with five post-warm-up runs.
python scripts/performance/run.py candidate --build \
  --candidate 8 --workload mailbox --concurrency 10 \
  --rows 20 --iterations 2 --runs 5

# Full configured FPM 8/16/30 matrix. This is intentionally long-running.
python scripts/performance/run.py matrix --build
```

Results are written below `benchmark/results/` and are ignored by Git. A run directory with `harness-error.json` is incomplete, not a measured baseline.

Stop only the isolated project:

```sh
python scripts/performance/run.py down
# Explicitly remove its synthetic volumes as well:
python scripts/performance/run.py down --volumes
```

See `docs/performance/phase-0-2-harness.md` for metrics, safety, configuration, and limitations. No benchmark results or resource savings are included here because no container measurement has been performed in this environment.
