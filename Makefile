PYTHON ?= python
SNAPSHOT ?= latest
SEED ?= 2027

.DEFAULT_GOAL := help
.PHONY: help setup download extract trips impact report map what-if faults bench test lint

help:
	@echo "help      List available targets"
	@echo "setup     Install the DuckDB spatial extension (requires network)"
	@echo "download  Download a checksum-verified snapshot (DATE=YYMMDD; default latest)"
	@echo "extract   Extract snapshot tables (stub)"
	@echo "trips     Generate fixed trips (SNAPSHOT=latest SEED=2027)"
	@echo "impact    Compare routing impact (OLD=YYMMDD NEW=YYMMDD)"
	@echo "report    Re-render report wording (DATE=YYYY-MM-DD)"
	@echo "map       Serve the results map at http://localhost:8000/site/"
	@echo "what-if   Evaluate a hypothetical edit (stub)"
	@echo "faults    Run injected faults (stub)"
	@echo "bench     Benchmark the pipeline (stub)"
	@echo "test      Run pytest"
	@echo "lint      Check code style and formatting"

setup:
	$(PYTHON) -c "import duckdb; c = duckdb.connect(config={'memory_limit': '1GB', 'threads': 1}); c.execute('INSTALL spatial'); c.close()"

download:
	@bash scripts/download.sh "$(DATE)"

extract:
	@echo "not implemented yet (Step 3)"

trips:
	route-impact trips --snapshot $(SNAPSHOT) --seed $(SEED)

impact:
	route-impact impact --old $(OLD) --new $(NEW)

report:
	route-impact report --date $(DATE)

map:
	@echo "http://localhost:8000/site/?date=$(DATE)"
	$(PYTHON) -m http.server 8000

what-if:
	@echo "not implemented yet (Step 9)"

faults:
	@echo "not implemented yet (Step 9)"

bench:
	@echo "not implemented yet (Step 12)"

test:
	$(PYTHON) -m pytest

lint:
	ruff check . && ruff format --check .
