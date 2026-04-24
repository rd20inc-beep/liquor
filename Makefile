SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: help up down reset logs deps migrate migrate-status migrate-revert dev api-dev typecheck lint fmt test clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

up: ## Start all infra containers (pg, redis, minio)
	docker-compose up -d
	@echo "Waiting for Postgres..."
	@until docker-compose exec -T postgres pg_isready -U $${POSTGRES_USER:-liquor} >/dev/null 2>&1; do sleep 1; done
	@echo "Infra ready."

down: ## Stop containers (keep data)
	docker-compose down

reset: ## Stop and WIPE all data (destructive)
	docker-compose down -v

logs: ## Tail infra logs
	docker-compose logs -f

deps: ## Install all workspace deps
	pnpm install

migrate: up ## Apply all pending migrations
	cd migrations && sqitch deploy db:pg://$${POSTGRES_USER:-liquor}:$${POSTGRES_PASSWORD:-liquor}@localhost:5435/$${POSTGRES_DB:-liquor}

migrate-status: ## Show migration state
	cd migrations && sqitch status db:pg://$${POSTGRES_USER:-liquor}:$${POSTGRES_PASSWORD:-liquor}@localhost:5435/$${POSTGRES_DB:-liquor}

migrate-revert: ## Revert last migration
	cd migrations && sqitch revert -y db:pg://$${POSTGRES_USER:-liquor}:$${POSTGRES_PASSWORD:-liquor}@localhost:5435/$${POSTGRES_DB:-liquor}

seed: ## Seed demo data
	pnpm --filter @liquor/api seed

dev: up migrate api-dev ## Bring up infra + run API

api-dev: ## Run API with watch mode (requires deps + migrate)
	pnpm --filter @liquor/api dev

typecheck: ## Typecheck all packages
	pnpm -r typecheck

lint: ## Lint
	pnpm lint

fmt: ## Format
	pnpm format

test: ## Run tests
	pnpm -r test

clean: ## Remove build artifacts + node_modules
	rm -rf node_modules api/node_modules packages/*/node_modules admin-web/node_modules mobile/node_modules
	rm -rf api/dist packages/*/dist
