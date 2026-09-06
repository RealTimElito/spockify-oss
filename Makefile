# Public Compose Makefile. Homelab k8s/release targets stay in the private tree.
.PHONY: help up down clean logs status gpu gpou demo demo-gpu kit docker-kit compose-up compose-down build-cli migrate ide add-model

help:
	@echo "make up          start chat (./docker/run.sh — podman-compose if present, else Docker if the API is up)"
	@echo "make down        stop containers (keeps ./data)"
	@echo "make clean       stop compose leftovers / free ports (keeps ./data; CLEAN_DATA=1 to wipe)"
	@echo "make logs        follow logs"
	@echo "make status      compose ps"
	@echo "make gpu         up with GPU + verify/self-heal (Docker gpus=all; Podman CDI or /dev/nvidia*)"
	@echo "make gpou        alias for make gpu (typo)"
	@echo "make demo        up with authorized security-demo overlay (not unfiltered)"
	@echo "make demo-gpu    GPU stack + authorized security-demo overlay (not unfiltered)"
	@echo "make ide         run desktop IDE container (Podman if present, else Docker)"
	@echo "make kit         pack dist/spockify-docker.zip"
	@echo "make build-cli   build packages/spockify-cli"
	@echo "make migrate     run sql/migrations against local Postgres (port 5433)"
	@echo "make add-model   TAG=<ollama-tag> [DEFAULT=1] — pull + wire LiteLLM"

up compose-up:
	chmod +x docker/run.sh docker-run.sh
	./docker/run.sh

down compose-down:
	chmod +x docker/run.sh
	./docker/run.sh down

clean:
	chmod +x docker/clean.sh
	./docker/clean.sh $(if $(filter 1,$(CLEAN_DATA)),--data,)

logs:
	chmod +x docker/run.sh
	./docker/run.sh logs

status:
	chmod +x docker/run.sh
	./docker/run.sh status

gpu:
	chmod +x docker/run.sh
	./docker/run.sh --gpu

gpou: gpu

demo:
	chmod +x docker/run.sh
	./docker/run.sh --demo security

demo-gpu:
	chmod +x docker/run.sh
	./docker/run.sh --gpu --demo security

ide:
	chmod +x docker/ide/run.sh
	./docker/ide/run.sh

kit docker-kit:
	chmod +x docker/pack-release.sh docker/run.sh docker/clean.sh docker/engine.sh docker-run.sh
	./docker/pack-release.sh

build-cli:
	cd packages/spockify-ide-client && npm install && npm run build
	cd packages/spockify-cli && npm install && npm run build
	chmod +x packages/spockify-cli/dist/index.js
	@echo "Run: node packages/spockify-cli/dist/index.js"
	@echo "Or:  cd packages/spockify-cli && npm link"

migrate:
	PGHOST=localhost PGPORT=5433 PGPASSWORD=$${POSTGRES_PASSWORD:-spockify-dev} \
		MIGRATIONS_DIR=./sql/migrations ./scripts/run-migrations.sh

add-model:
	chmod +x docker/add-model.sh docker/engine.sh
	./docker/add-model.sh
