# cdk-zero-etl-pipeline

**CDK sin miedo**: integración Zero-ETL entre **Aurora PostgreSQL** y **Amazon Redshift Serverless** con un CodePipeline self-mutating opcional.

> **💰 Costo estimado de la demo**
> Una sesión de 2-3 horas + destruir al terminar: **~$0.50 USD total**.
> Aurora `db.t4g.medium` cuesta $0.073/hr; Redshift Serverless solo cobra al ejecutar queries; no hay NAT Gateway en modo demo. Detalles en [Costos](#costos).

---

## Qué construye

Cuatro stacks orquestados en un `cdk.Stage`:

1. **NetworkingStack** — VPC, subnets, security groups (L2 puro)
2. **AuroraStack** — Aurora PostgreSQL 16.4 provisioned, cluster con 1 sola instance `db.t4g.medium` (L2)
3. **RedshiftStack** — Namespace + Workgroup de Redshift Serverless (L1)
4. **ZeroEtlStack** — Resource policy + `rds.CfnIntegration` con `dataFilter: 'include: demodb.public.*'` (L1)

Opcionalmente:

5. **PipelineStack** — CodePipeline self-mutating con `ManualApprovalStep` antes de desplegar `ZeroEtlStack`; se autodespliega en cada `git push`

---

## Por qué esta configuración

| Decisión | Razón |
|---|---|
| **Aurora provisioned** (no Serverless v2) | Más predecible y barato para una demo corta. Serverless v2 mínimo es 0.5 ACU = $0.06/hr; t4g.medium = $0.073/hr pero sin sorpresas de auto-scaling |
| **db.t4g.medium** | La instance class **más pequeña permitida** en Aurora PG. Aurora no soporta t3.small ni t4g.small |
| **Sin readers** | 1 sola writer ahorra otro $0.073/hr |
| **1 cluster, no Serverless v2** | Zero-ETL fuerza logical replication, lo que impide el auto-pause de Serverless v2 — así que el "scale to zero" no aplica de todos modos |
| **Redshift Serverless** | Solo cobra cuando ejecutas queries. En idle = $0 |
| **3 AZs en la VPC** | Redshift Serverless requiere subnets en mínimo 2 AZs (sin EVR) desde julio 2025. Usamos 3 para máxima compatibilidad regional; en modo demo no hay NAT, así que la 3a AZ no cuesta nada |
| **public subnets en demo** | 0 NAT Gateways = ahorras $32/mes por NAT |

---

## Costos

| Recurso | Precio | Demo 3h |
|---|---|---|
| Aurora `db.t4g.medium` (1 writer) | $0.073/hr | $0.22 |
| Aurora storage (Standard, prorrateado) | $0.10/GB-mes | <$0.05 |
| Redshift Serverless workgroup idle | $0 | $0 |
| Redshift Serverless queries | $0.375 por RPU-hr × 8 RPU | ~$0.10 si haces queries |
| NAT Gateway (modo demo) | $0 | $0 |
| Secrets Manager (2 secrets) | $0.40/mes c/u prorrateado | <$0.01 |
| VPC, subnets, IGW | Gratis | $0 |
| **Total demo 3h + destruir** | | **~$0.40-0.50 USD** |

> Si dejas todo encendido **24 horas seguidas** sin destruir: ~$2.50/día.
> Por eso es **crítico** ejecutar `cdk destroy --all --force` al terminar.

---

## Estructura del proyecto

```
cdk-zero-etl-pipeline/
├── bin/
│   └── app.ts                       # Entry point con switch demo/pipeline
├── lib/
│   ├── pipeline-stack.ts            # CodePipeline opcional
│   ├── stages/
│   │   └── deploy-stage.ts          # Stage que agrupa los 4 stacks
│   └── stacks/
│       ├── networking-stack.ts      # VPC + SGs (flag demoMode)
│       ├── aurora-stack.ts          # Aurora PostgreSQL t4g.medium
│       ├── redshift-stack.ts        # Redshift Serverless (L1)
│       └── zero-etl-stack.ts        # CfnIntegration + resource policy
├── sql/
│   ├── 01-aurora-source.sql         # Schema + datos en Aurora
│   └── 02-redshift-target.sql       # CREATE DATABASE FROM INTEGRATION
├── test/
│   └── stacks.test.ts               # 25 tests unitarios
├── cdk.json
├── jest.config.js
├── package.json
├── tsconfig.json
└── README.md                        # Este archivo
```

---

## Modos de despliegue

Dos modos controlados por flags de contexto CDK:

| Flag | Default | Qué hace |
|---|---|---|
| `demoMode` | `true` | Public subnets, 0 NAT, DBs accesibles por tu IP/32 |
| `usePipeline` | `false` | `true` despliega un CodePipeline self-mutating |
| `myIp` | (vacío) | IP/32 desde donde te conectas (solo demo) |

Combinaciones:

```bash
# Demo más simple (deploy directo)
npx cdk deploy --all -c myIp=$(curl -s ifconfig.me)/32

# Demo con pipeline (ver sección Pipeline más abajo)
npx cdk deploy CdkZeroEtl-Pipeline -c usePipeline=true -c myIp=$MY_IP --require-approval never

# Producción
npx cdk deploy --all -c demoMode=false
```

---

## Quick start

### Deploy directo (demo local)

```bash
npm install
npm test                                          # 25 tests
npx cdk bootstrap aws://TU_ACCOUNT/us-east-1      # una sola vez
export MY_IP=$(curl -s ifconfig.me)/32
npx cdk deploy --all -c myIp=$MY_IP --require-approval never
```

**Tiempo de deploy:** ~12-15 min (Aurora provisioned tarda ~8 min, más rápido que Serverless v2).

Después del deploy, en el Redshift Query Editor v2:

```sql
SELECT integration_id FROM svv_integration;
CREATE DATABASE aurora_data FROM INTEGRATION '<id>' DATABASE demodb;
```

### Deploy con Pipeline (self-mutating)

```bash
# 1. Crear PAT en GitHub: Settings → Developer settings → Personal access tokens
#    Scopes: repo, admin:repo_hook

# 2. Guardarlo en Secrets Manager
aws secretsmanager create-secret \
  --name github-token \
  --secret-string "ghp_TU_TOKEN" \
  --region us-east-1

# 3. Configurar tu owner/repo en bin/app.ts o por env
export GITHUB_OWNER=tu-usuario
export GITHUB_REPO=cdk-zero-etl-pipeline

# 4. Deploy SOLO el PipelineStack
npx cdk deploy CdkZeroEtl-Pipeline \
  -c usePipeline=true \
  -c myIp=$MY_IP \
  --require-approval never
```

> El pipeline tiene un paso de **aprobación manual** (`ManualApprovalStep`) antes de desplegar `ZeroEtlStack`. Tienes que poblar la DB Aurora con el script sql/01-aurora-source.sql usando la terminal. Aprueba el pipeline desde la consola de CodePipeline cuando quieras activar la integración Zero-ETL.


>Copia el ID de la integración de ZeroETL.
>Luego ve a Redshift Query EditorV2 y usa el script sql/02-redshift-target.sql para crear la DB usando la integración.
---

## Tests

```bash
npm test
```

| Stack | Qué valida |
|---|---|
| NetworkingStack (demo) | 1 VPC, 0 NAT, public subnets, SG con tu IP |
| NetworkingStack (prod) | 2 NAT, 3 capas de subnets |
| AuroraStack | Cluster PG, 1 instance, **db.t4g.medium**, enhanced_logical_replication, no es serverless |
| RedshiftStack | Namespace + workgroup, manageAdminPassword, case_sensitive |
| ZeroEtlStack | CfnIntegration, ARNs, Custom Resource, **acción IAM correcta**, dataFilter |
| PipelineStack | CodePipeline + CodeBuild + ManualApprovalStep |

---

## Eliminar todo al finalizar

```sql
-- En Redshift Query Editor v2
DROP DATABASE aurora_data;
```

```bash
npx cdk destroy --all --force
aws secretsmanager delete-secret --secret-id zero-etl/aurora/admin \
  --force-delete-without-recovery --region us-east-1
```

Verifica que no queda nada:

```bash
aws cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --query 'StackSummaries[?contains(StackName, `CdkZeroEtl`)].StackName' \
  --output table

aws rds describe-db-clusters --query 'DBClusters[].DBClusterIdentifier' --output table
aws redshift-serverless list-workgroups --query 'workgroups[].workgroupName' --output table
```

---

## Licencia

MIT
