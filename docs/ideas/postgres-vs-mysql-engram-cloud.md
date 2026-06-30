# PostgreSQL 16 vs MySQL 8.x para Engram Cloud

← [README](../README.md)

Guía comparativa para adaptar el despliegue de Engram Cloud de PostgreSQL a MySQL 8.x.

## Cambios necesarios en `docker-compose.yml`

### PostgreSQL 16 (actual — ver [deploy-cloud-vps.md](deploy-cloud-vps.md))

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    env_file: .env
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U engram"]
      interval: 5s
      timeout: 3s
      retries: 5

  cloud:
    image: ghcr.io/gentleman-programming/engram:latest
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    env_file: .env
    ports:
      - "127.0.0.1:18080:18080"

volumes:
  pgdata:
```

### MySQL 8.x (propuesto)

```yaml
services:
  mysql:
    image: mysql:8.0
    restart: unless-stopped
    env_file: .env
    volumes:
      - mysqldata:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 5s
      timeout: 3s
      retries: 5

  cloud:
    image: ghcr.io/gentleman-programming/engram:latest
    restart: unless-stopped
    depends_on:
      mysql:
        condition: service_healthy
    env_file: .env
    ports:
      - "127.0.0.1:18080:18080"

volumes:
  mysqldata:
```

## Cambios en `.env`

| Variable | PostgreSQL | MySQL 8.x |
|---|---|---|
| DB user/pass | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `MYSQL_ROOT_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD` |
| Connection string | `postgres://engram:pass@postgres:5432/engram?sslmode=disable` | `engram:pass@tcp(mysql:3306)/engram?charset=utf8mb4&parseTime=True&loc=Local` |

### `.env` para MySQL 8.x

```bash
# MySQL
MYSQL_ROOT_PASSWORD=<genera un secreto fuerte: openssl rand -hex 32>
MYSQL_DATABASE=engram
MYSQL_USER=engram
MYSQL_PASSWORD=<genera otro secreto fuerte>

# Engram Cloud
ENGRAM_CLOUD_DATABASE_URL=engram:<PASSWORD>@tcp(mysql:3306)/engram?charset=utf8mb4&parseTime=True&loc=Local
ENGRAM_CLOUD_TOKEN=<genera otro secreto fuerte: openssl rand -hex 32>
ENGRAM_CLOUD_DASHBOARD=true
```

## Tabla comparativa

| Aspecto | PostgreSQL 16 | MySQL 8.x |
|---|---|---|
| Imagen Docker | `postgres:16-alpine` (~80MB) | `mysql:8.0` (~450MB) |
| Healthcheck | `pg_isready -U engram` | `mysqladmin ping -h localhost` |
| Volúmenes | `/var/lib/postgresql/data` | `/var/lib/mysql` |
| Driver Go | `lib/pq` o `pgx` | `go-sql-driver/mysql` |
| Connection string | `postgres://` | `user:pass@tcp(host:port)/db?...` |
| JSON nativo | `JSONB` (índices GIN) | `JSON` + funciones |
| Arrays nativos | Sí (`text[]`, `int[]`) | No (usa tablas relacionales) |
| Full-text search | `tsvector`/`tsquery` | `FULLTEXT` indexes |
| Concurrency | MVCC sin locks de lectura | MVCC con read locks en algunos casos |
| Backup | `pg_dump` | `mysqldump` |

## Bloqueador: ¿Engram soporta MySQL?

Depende del código fuente de [github.com/Gentleman-Programming/engram](https://github.com/Gentleman-Programming/engram):

- **Si usa GORM**: con cambiar el driver (`postgres` → `mysql`) y el DSN, funcionaría.
- **Si usa SQL nativo con funciones Postgres** (`JSONB`, `NOW()`, `ARRAY`, `ILIKE`, `RETURNING`): requiere tocar el código de Engram.

### Para verificar rápido

```bash
# 1. Desplegar con MySQL (docker-compose arriba)
docker compose up -d

# 2. Ver logs del contenedor cloud:
docker logs engram-cloud-cloud-1
# Si falla con "unsupported driver" o "syntax error", no hay soporte MySQL.

# 3. Si conecta, verificar health:
curl http://127.0.0.1:18080/health
```

## Backup con MySQL

```bash
# Dump de MySQL (cron diario):
docker exec engram-cloud-mysql-1 mysqldump -u engram -p<PASSWORD> engram | gzip > /backups/engram-$(date +%F).sql.gz
```

## Recomendación

- **Mantener PostgreSQL** si no hay requisito específico de MySQL. Es lo que Engram espera.
- **Migrar a MySQL** solo si el equipo ya tiene infra MySQL operativa (DBA, backups, monitoreo) y se confirma que Engram tiene driver MySQL compilado.
