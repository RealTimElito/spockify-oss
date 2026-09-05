# Public Compose Makefile. Homelab k8s/release targets stay in the private tree.
.PHONY: help up down logs status gpu kit docker-kit compose-up compose-down build-cli migrate

help:
	@echo "make up          start chat (./docker/run.sh — pulls GHCR, no local Vite)"
	@echo "make down        stop containers (keeps ./data)"
	@echo "make logs        follow logs"
	@echo "make status      compose ps"
	@echo "make gpu         up with docker-compose.gpu.yml"
	@echo "make kit         pack dist/spockify-docker.zip"
	@echo "make build-cli   build packages/spockify-cli"
	@echo "make migrate     run sql/migrations against local Postgres (port 5433)"

up compose-up:
	chmod +x docker/run.sh docker-run.sh
	./docker/run.sh

down compose-down:
	chmod +x docker/run.sh
	./docker/run.sh down

logs:
	chmod +x docker/run.sh
	./docker/run.sh logs

status:
	chmod +x docker/run.sh
	./docker/run.sh status

gpu:
	chmod +x docker/run.sh
	./docker/run.sh --gpu

kit docker-kit:
	chmod +x docker/pack-release.sh docker/run.sh docker-run.sh
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
