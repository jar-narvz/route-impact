# Builds the CCH order tool against a pinned RoutingKit commit (BSD-2-Clause).
# RoutingKit is cloned into data/ (gitignored), never vendored. Run from the repo root:
#   make -C scripts/cch_order
# Fixed flags (no -march=native / -ffast-math, unlike RoutingKit's own Makefile) so the
# floating-point inertial-flow cuts, and therefore the order, are reproducible.

ROOT       := $(abspath ../..)
RK_URL     := https://github.com/RoutingKit/RoutingKit.git
RK_COMMIT  := 54d49bb0cdea56dde182357522e4e86a03c57852
RK_DIR     := $(ROOT)/data/routingkit
OUT_DIR    := $(ROOT)/data/cch_order
BIN        := $(OUT_DIR)/cch_order
CXX        ?= c++
CXXFLAGS   := -std=c++17 -O2 -DNDEBUG -fno-fast-math -ffp-contract=off -I$(RK_DIR)/include
RK_SOURCES := nested_dissection bit_vector bit_select timer graph_util id_mapper

all: $(BIN)

$(RK_DIR)/.pinned:
	@if [ ! -d $(RK_DIR)/.git ]; then git clone -q $(RK_URL) $(RK_DIR); fi
	git -C $(RK_DIR) fetch -q origin $(RK_COMMIT) || true
	git -C $(RK_DIR) checkout -q $(RK_COMMIT)
	@test "$$(git -C $(RK_DIR) rev-parse HEAD)" = "$(RK_COMMIT)"
	touch $@

$(BIN): main.cpp $(RK_DIR)/.pinned
	mkdir -p $(OUT_DIR)
	$(CXX) $(CXXFLAGS) -o $@ main.cpp $(addprefix $(RK_DIR)/src/,$(addsuffix .cpp,$(RK_SOURCES)))
	@echo "built $@ ($$($(CXX) --version | head -1)); flags: $(CXXFLAGS)"

flags:
	@echo "$(CXXFLAGS)"

commit:
	@echo "$(RK_COMMIT)"

.PHONY: all flags commit
