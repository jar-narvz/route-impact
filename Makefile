PYTHON ?= python

.DEFAULT_GOAL := help
.PHONY: help setup download extract trips impact report map what-if faults demos bench bench-js test test-js lint

help:
	@echo "help      List available targets"
	@echo "setup     Install the DuckDB spatial extension (requires network)"
	@echo "download  Download a checksum-verified snapshot (DATE=YYMMDD; default latest)"
	@echo "extract   Extract snapshot tables (stub)"
	@echo "trips     Generate fixed trips (SNAPSHOT=latest SEED=2027)"
	@echo "impact    Compare routing impact (OLD=YYMMDD NEW=YYMMDD)"
	@echo "report    Re-render report wording (DATE=YYYY-MM-DD)"
	@echo "map       Serve the results map at http://localhost:8000/site/"
	@echo "what-if   Evaluate edits (SNAPSHOT=YYMMDD ARGS='--delete-way ID')"
	@echo "faults    Run injected faults (SNAPSHOT=YYMMDD N=200 SEED=2027 FULL_CHECK_EVERY=10)"
	@echo "demos     Run the three configured what-if demos (SNAPSHOT=261027)"
	@echo "bench     Benchmark the pipeline (SNAPSHOT=YYMMDD [OLD=YYMMDD])"
	@echo "test      Run pytest and JavaScript tests"
	@echo "test-js   Run JavaScript core tests (Node >= 22)"
	@echo "lint      Check code style and formatting"

setup:
	$(PYTHON) -c "import duckdb; c = duckdb.connect(config={'memory_limit': '1GB', 'threads': 1}); c.execute('INSTALL spatial'); c.close()"

download:
	@bash scripts/download.sh "$(DATE)"

extract:
	@echo "not implemented yet (Step 3)"

trips: SNAPSHOT ?= latest
trips: SEED ?= 2027
trips:
	route-impact trips --snapshot $(SNAPSHOT) --seed $(SEED)

impact:
	route-impact impact --old $(OLD) --new $(NEW)

report:
	route-impact report --date $(DATE)

map:
	@echo "http://localhost:8000/site/?date=$(DATE)"
	$(PYTHON) -m http.server 8000

what-if: SNAPSHOT ?= latest
what-if:
	route-impact what-if --snapshot $(SNAPSHOT) $(ARGS)

faults: SNAPSHOT ?= latest
faults: N ?= 200
faults: SEED ?= 2027
faults: FULL_CHECK_EVERY ?= 10
faults:
	route-impact faults --snapshot $(SNAPSHOT) --n $(N) --seed $(SEED) --full-check-every $(FULL_CHECK_EVERY)

demos: SNAPSHOT ?= 261027
demos:
	$(PYTHON) -c "from route_impact.faults import run_demos; run_demos('$(SNAPSHOT)')"

bench: SNAPSHOT ?= 261027
bench:
	PYTHON="$(PYTHON)" bash scripts/bench.sh $(SNAPSHOT) $(OLD)

bench-js:
	node --expose-gc site/playground/core/test/cch_bench.mjs

test:
	$(PYTHON) -m pytest
	$(MAKE) test-js

test-js:
	node --test 'site/playground/core/test/*.test.mjs'

lint:
	ruff check . && ruff format --check .
