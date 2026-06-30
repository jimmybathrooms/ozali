# Desplegar Engram Cloud en Google Cloud

← [README](../README.md)

Dos opciones para desplegar el **servidor de Engram Cloud** en Google Cloud Platform, según el
perfil de carga y mantenimiento que prefieras.

## Opción A: Cloud Run + Cloud SQL (serverless, managed)

La opción más **hands-off**: Postgres gestionado por Google, Engram en Cloud Run (serverless,
escala a cero). Ideal si no quieres mantener VMs.

### Componentes

| Servicio | Qué hace | Coste aprox. |
|---|---|---|
| Cloud SQL (Postgres 16) | Base de datos gestionada | ~$15-30/mes (db-f1-micro) |
| Cloud Run | Ejecuta el servidor Engram | $0 por inactivo + por uso |
| Secret Manager | Guarda el token y DB URL | gratis hasta 6 secretos |
| Artifact Registry | Imagen Docker de Engram | gratis hasta 0.5 GB |

### Pasos

1. **Crear instancia de Cloud SQL:**
   ```bash
   gcloud sql instances create engram-db \
     --database-version=POSTGRES_16 \
     --tier=db-f1-micro \
     --region=us-central1 \
     --root-password=$(openssl rand -hex 32)
   ```

2. **Crear base de datos y usuario:**
   ```bash
   gcloud sql databases create engram --instance=engram-db
   gcloud sql users create engram --instance=engram-db --password=$(openssl rand -hex 16)
   ```

3. **Subir la imagen a Artifact Registry:**
   ```bash
   gcloud artifacts repositories create engram --repository-format=docker --location=us-central1
   docker pull ghcr.io/gentleman-programming/engram:latest
   docker tag ghcr.io/gentleman-programming/engram:latest \
     us-central1-docker.pkg.dev/$PROJECT_ID/engram/cloud:latest
   docker push us-central1-docker.pkg.dev/$PROJECT_ID/engram/cloud:latest
   ```

4. **Crear secretos en Secret Manager:**
   ```bash
   echo -n "postgres://engram:...@/engram?cloudsql=/cloudsql/$PROJECT_ID:us-central1:engram-db" \
     | gcloud secrets create ENGRAM_CLOUD_DATABASE_URL --data-file=-
   echo -n "$(openssl rand -hex 32)" \
     | gcloud secrets create ENGRAM_CLOUD_TOKEN --data-file=-
   ```

5. **Desplegar en Cloud Run:**
   ```bash
   gcloud run deploy engram-cloud \
     --image=us-central1-docker.pkg.dev/$PROJECT_ID/engram/cloud:latest \
     --region=us-central1 \
     --port=18080 \
     --no-allow-unauthenticated \
     --add-cloudsql-instances=$PROJECT_ID:us-central1:engram-db \
     --set-secrets="ENGRAM_CLOUD_DATABASE_URL=ENGRAM_CLOUD_DATABASE_URL:latest" \
     --set-secrets="ENGRAM_CLOUD_TOKEN=ENGRAM_CLOUD_TOKEN:latest" \
     --set-env-vars="ENGRAM_CLOUD_DASHBOARD=true"
   ```

6. **IAM — quién puede acceder:**
   - Los devs no acceden a Cloud Run directamente; lo hace el CLI de Engram.
   - Si Cloud Run está `--no-allow-unauthenticated`, configura un endpoint público con
     Cloud Armor (IP allowlist) o un Identity-Aware Proxy (IAP).

7. **VPC connector para Cloud SQL:**
   Si Cloud SQL tiene IP privada (recomendado), crea un Serverless VPC connector:
   ```bash
   gcloud compute networks vpc-access connectors create engram-conn \
     --network=default --region=us-central1 --range=10.8.0.0/28
   ```
   Y en el deploy de Cloud Run añade `--vpc-connector=engram-conn`.

### Verificar
   ```bash
   gcloud run services describe engram-cloud --region=us-central1 --format='value(status.url)'
   curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
     https://engram-cloud-xxxx-uc.a.run.app/health
   ```

## Opción B: GCE VM + docker-compose (similar al VPS)

Si prefieres control total (equivalente al [despliegue VPS](deploy-cloud-vps.md) pero en GCE):

1. **Crear VM:**
   ```bash
   gcloud compute instances create engram-cloud \
     --machine-type=e2-small \
     --zone=us-central1-a \
     --image-family=ubuntu-2204-lts \
     --image-project=ubuntu-os-cloud \
     --boot-disk-size=30GB \
     --tags=engram-cloud
   ```

2. **Firewall (solo HTTP/HTTPS + SSH):**
   ```bash
   gcloud compute firewall-rules create engram-allow-http \
     --allow=tcp:80,tcp:443 --target-tags=engram-cloud
   ```

3. **SSH e instalar Docker:**
   ```bash
   gcloud compute ssh engram-cloud --zone=us-central1-a
   # dentro de la VM:
   sudo apt update && sudo apt install -y docker.io docker-compose-v2 nginx certbot python3-certbot-nginx
   sudo usermod -aG docker $USER
   ```

4. **Desplegar igual que el VPS:**
   - Copia `docker-compose.yml` y `.env` (ver [deploy-cloud-vps.md](deploy-cloud-vps.md))
   - Configura nginx + Let's Encrypt
   - Configura systemd para auto-start

### Ventajas de GCE vs VPS genérico
- **Secret Manager:** los secretos viven en GCP, no en un `.env` en disco
- **Snapshots programados** del disco para backups
- **Cloud Logging** centralizado
- **MIG (Managed Instance Group)** si necesitas HA

## Comparación rápida

| | Opción A (Cloud Run) | Opción B (GCE VM) |
|---|---|---|
| Mantenimiento | Mínimo (serverless) | Medio (gestionas la VM) |
| Coste en reposo | ~$0 (Cloud Run escala a 0) | ~$13/mes (e2-small) |
| Cold start | Sí (1-3s tras inactividad) | No |
| Control | Limitado | Total |
| Backups | Automáticos (Cloud SQL) | Manuales (snapshots) |
| Recomendado para | Equipos pequeños/medianos | Equipos con carga constante o compliance estricto |

## Conectar los devs

Independiente de la opción elegida, cada dev conecta con:

```bash
ozali init
# → "¿Habilitar Engram Cloud?" → sí
# → URL: https://engram-cloud-xxxx.a.run.app  (A) o https://engram.mi-empresa.com (B)
# → Token: <ENGRAM_CLOUD_TOKEN>
```
