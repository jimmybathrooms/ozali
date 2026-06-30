# Desplegar Engram Cloud en un VPS

← [README](../README.md)

Guía para desplegar el **servidor de Engram Cloud** en un VPS genérico (DigitalOcean, Hetzner,
Linode, AWS EC2, etc.). El servidor centraliza la memoria de equipo: los devs replican a él
con `ozali sync --cloud` (o automáticamente con autosync).

## Requisitos

- VPS con Linux (Ubuntu 22.04+ recomendado) y acceso SSH
- Docker Engine + Docker Compose v2
- Un dominio (o subdominio) apuntando al VPS
- Puertos: 80/443 (nginx) abiertos al público; 18080 solo localhost

## 1. docker-compose.yml

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
      - "127.0.0.1:18080:18080"  # solo localhost; nginx expone al exterior

volumes:
  pgdata:
```

> El `cloud` escucha en `127.0.0.1:18080` (no `0.0.0.0`): nginx hace de reverse proxy con TLS
> y es el único expuesto al público.

## 2. .env (secretos fuertes)

```bash
# Postgres
POSTGRES_USER=engram
POSTGRES_PASSWORD=<genera un secreto fuerte: openssl rand -hex 32>
POSTGRES_DB=engram

# Engram Cloud
ENGRAM_CLOUD_DATABASE_URL=postgres://engram:<PASSWORD>@postgres:5432/engram?sslmode=disable
ENGRAM_CLOUD_TOKEN=<genera otro secreto fuerte: openssl rand -hex 32>
ENGRAM_CLOUD_DASHBOARD=true
```

> **El `ENGRAM_CLOUD_TOKEN` es lo que pide `ozali init` a cada dev.** Compártelo por canal
> seguro (1Password, Bitwarden, Signal), nunca por email/chat del repo.

## 3. Hardening

### 3.1 Firewall (ufw)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp      # SSH (considera cambiar el puerto)
sudo ufw allow 80/tcp      # HTTP (nginx → redirige a HTTPS)
sudo ufw allow 443/tcp     # HTTPS (nginx)
sudo ufw enable
```

### 3.2 nginx reverse proxy con SSL (Let's Encrypt)

```nginx
server {
    listen 80;
    server_name engram.mi-empresa.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name engram.mi-empresa.com;

    ssl_certificate     /etc/letsencrypt/live/engram.mi-empresa.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/engram.mi-empresa.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    location / {
        proxy_pass         http://127.0.0.1:18080;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

Certbot para el certificado:

```bash
sudo certbot --nginx -d engram.mi-empresa.com
```

### 3.3 systemd para auto-start

```ini
# /etc/systemd/system/engram-cloud.service
[Unit]
Description=Engram Cloud (Docker Compose)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/engram-cloud
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now engram-cloud
```

## 4. Verificar

```bash
# En el VPS:
docker compose ps              # ambos servicios "healthy"
curl http://127.0.0.1:18080/health  # debería responder OK

# Desde fuera:
curl https://engram.mi-empresa.com/health
```

## 5. Conectar los devs

Cada dev en su repo:

```bash
ozali init
# → "¿Habilitar Engram Cloud?" → sí
# → URL: https://engram.mi-empresa.com
# → Token: <el ENGRAM_CLOUD_TOKEN del .env>
# → autosync activo
```

Si el servidor requiere upgrade de esquema:

```bash
ozali cloud upgrade   # doctor → repair → bootstrap
```

## Backups

```bash
# Dump de Postgres (cron diario):
docker exec engram-cloud-postgres-1 pg_dump -U engram engram | gzip > /backups/engram-$(date +%F).sql.gz
```

Mantén los backups fuera del VPS (S3, GCS, almacenamiento externo).
