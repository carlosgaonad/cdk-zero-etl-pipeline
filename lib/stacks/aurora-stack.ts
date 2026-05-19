import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Construct } from 'constructs';

export interface AuroraStackProps extends cdk.StackProps {
  readonly vpc: ec2.IVpc;
  readonly auroraSecurityGroup: ec2.ISecurityGroup;
  /** Si true: subnets PUBLIC + publiclyAccessible. Si false: ISOLATED. */
  readonly demoMode: boolean;
}

/**
 * Aurora PostgreSQL provisioned — FUENTE del Zero-ETL.
 *
 * Configuración MÍNIMA para una demo de bajo costo:
 *
 *   - Engine: Aurora PostgreSQL 16.4
 *   - Cluster con 1 sola writer instance (sin readers)
 *   - Instance class: db.t4g.medium (la más pequeña permitida en Aurora PG)
 *     Aurora PG no soporta db.t3.small ni db.t4g.small. Las opciones mínimas
 *     son db.t3.medium o db.t4g.medium. db.t4g.medium es Graviton2 y más barato.
 *
 * Costo durante la demo:
 *   - db.t4g.medium: ~$0.073/hr (Aurora Standard, us-east-1)
 *   - Storage Aurora Standard: $0.10/GB-mes + $0.20/millón I/O
 *   - Demo de 3 horas: ~$0.22 USD compute + storage prorrateado
 *
 * Parámetros OBLIGATORIOS para Zero-ETL con Aurora PostgreSQL:
 *   - rds.logical_replication = 1
 *   - aurora.enhanced_logical_replication = 1
 *   - aurora.logical_replication_backup = 0
 *   - aurora.logical_replication_globaldb = 0
 *
 * Sin estos parámetros, el deploy pasa pero la integración Zero-ETL falla
 * en runtime con un error críptico. Es el gotcha #1.
 */
export class AuroraStack extends cdk.Stack {
  /** ARN del cluster — sourceArn del Zero-ETL */
  public readonly clusterArn: string;
  public readonly clusterEndpoint: string;
  public readonly secretArn: string;

  constructor(scope: Construct, id: string, props: AuroraStackProps) {
    super(scope, id, props);

    // ── Engine ───────────────────────────────────
    const engine = rds.DatabaseClusterEngine.auroraPostgres({
      version: rds.AuroraPostgresEngineVersion.VER_16_4,
    });

    // ── Cluster parameter group (Zero-ETL requirements) ──
    const clusterParamGroup = new rds.ParameterGroup(this, 'ClusterParams', {
      engine,
      description: 'Aurora PostgreSQL params for Zero-ETL replication',
      parameters: {
        'rds.logical_replication': '1',
        'aurora.enhanced_logical_replication': '1',
        'aurora.logical_replication_backup': '0',
        'aurora.logical_replication_globaldb': '0',
      },
    });

    // ── Credentials (auto-generadas en Secrets Manager) ──
    const credentials = rds.Credentials.fromGeneratedSecret('postgres', {
      secretName: 'zero-etl/aurora/admin',
    });

    // ── Aurora Cluster ──────────────────────────
    const cluster = new rds.DatabaseCluster(this, 'AuroraCluster', {
      engine,
      parameterGroup: clusterParamGroup,
      credentials,
      vpc: props.vpc,
      vpcSubnets: props.demoMode
        ? { subnetType: ec2.SubnetType.PUBLIC }
        : { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [props.auroraSecurityGroup],
      defaultDatabaseName: 'demodb',
      storageEncrypted: true,
      // ── Configuración MÍNIMA: 1 writer t4g.medium, sin readers ──
      // db.t4g.medium: 2 vCPU burstable + 4 GB RAM (Graviton2).
      // Es la instance class más pequeña permitida en Aurora PG.
      writer: rds.ClusterInstance.provisioned('Writer', {
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.T4G,
          ec2.InstanceSize.MEDIUM,
        ),
        publiclyAccessible: props.demoMode,
      }),
      // Sin readers para esta demo.
      backup: { retention: cdk.Duration.days(1) },
      removalPolicy: cdk.RemovalPolicy.DESTROY, // demo
      deletionProtection: false, // demo
    });

    this.clusterArn = cluster.clusterArn;
    this.clusterEndpoint = cluster.clusterEndpoint.hostname;
    this.secretArn = cluster.secret!.secretArn;

    // ── Outputs ──────────────────────────────────
    new cdk.CfnOutput(this, 'ClusterArn', {
      value: cluster.clusterArn,
      description: 'ARN del cluster (sourceArn del Zero-ETL)',
    });

    new cdk.CfnOutput(this, 'ClusterEndpoint', {
      value: cluster.clusterEndpoint.hostname,
      description: 'Hostname para conectarse con psql',
    });

    new cdk.CfnOutput(this, 'SecretArn', {
      value: cluster.secret!.secretArn,
      description: 'aws secretsmanager get-secret-value --secret-id zero-etl/aurora/admin',
    });
  }
}
