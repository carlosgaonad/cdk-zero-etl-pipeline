import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface NetworkingStackProps extends cdk.StackProps {
  /**
   * demoMode = true  → public subnets, 0 NAT Gateway, DBs accesibles por IP.
   * demoMode = false → 3 capas (public + private + isolated), NAT por AZ.
   */
  readonly demoMode: boolean;
  /**
   * En demoMode, IP/32 desde donde te conectas (ej: "190.x.x.x/32").
   * Si no se pasa, el SG queda vacío y NADIE puede conectarse.
   */
  readonly myIpCidr?: string;
}

/**
 * Networking foundation para la plataforma analítica.
 *
 * Para la charla:
 *   - L2 puro de aws-ec2.Vpc.
 *   - Un solo booleano (demoMode) decide ~30 recursos generados.
 *   - `cdk diff` muestra el cambio sin aplicarlo: ese es el "wow moment".
 */
export class NetworkingStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly auroraSecurityGroup: ec2.SecurityGroup;
  public readonly redshiftSecurityGroup: ec2.SecurityGroup;
  public readonly demoMode: boolean;

  constructor(scope: Construct, id: string, props: NetworkingStackProps) {
    super(scope, id, props);
    this.demoMode = props.demoMode;

    // ── VPC ──────────────────────────────────────
    // IMPORTANTE: Redshift Serverless necesita subnets en al menos 2 AZ desde
    // julio 2025 (antes eran 3). Para máxima compatibilidad regional usamos 3:
    //   - Algunas regiones pueden no haber propagado el cambio aún.
    //   - Si en el futuro activamos Enhanced VPC Routing, 3 AZ es obligatorio.
    //   - En modo demo no hay NAT Gateway, así que la 3a AZ no cuesta nada.
    if (props.demoMode) {
      // Solo public subnets. Ahorras ~$32/mes del NAT Gateway.
      this.vpc = new ec2.Vpc(this, 'AnalyticsVpc', {
        maxAzs: 3,
        natGateways: 0,
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            mapPublicIpOnLaunch: false,
          },
        ],
      });
    } else {
      // Producción: 3 capas. NAT en cada AZ para HA.
      this.vpc = new ec2.Vpc(this, 'AnalyticsVpc', {
        maxAzs: 3,
        natGateways: 3, // 1 NAT por AZ para HA real
        subnetConfiguration: [
          { name: 'Public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
          {
            name: 'Private',
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            cidrMask: 24,
          },
          {
            name: 'Isolated',
            subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            cidrMask: 24,
          },
        ],
      });
    }

    // ── Security Groups ─────────────────────────
    this.auroraSecurityGroup = new ec2.SecurityGroup(this, 'AuroraSG', {
      vpc: this.vpc,
      description: 'SG para Aurora PostgreSQL (fuente Zero-ETL)',
      allowAllOutbound: true,
    });

    this.redshiftSecurityGroup = new ec2.SecurityGroup(this, 'RedshiftSG', {
      vpc: this.vpc,
      description: 'SG para Redshift Serverless (destino Zero-ETL)',
      allowAllOutbound: true,
    });

    if (props.demoMode) {
      // En demo, ambas DBs son accesibles desde tu laptop.
      if (props.myIpCidr) {
        this.auroraSecurityGroup.addIngressRule(
          ec2.Peer.ipv4(props.myIpCidr),
          ec2.Port.tcp(5432),
          'Aurora PG desde mi laptop (demo)',
        );
        this.redshiftSecurityGroup.addIngressRule(
          ec2.Peer.ipv4(props.myIpCidr),
          ec2.Port.tcp(5439),
          'Redshift desde mi laptop (demo)',
        );
      }
    } else {
      // En prod, Redshift puede llegar a Aurora (aunque Zero-ETL no lo
      // necesita estrictamente, es buena base para otras integraciones).
      this.auroraSecurityGroup.addIngressRule(
        this.redshiftSecurityGroup,
        ec2.Port.tcp(5432),
        'Redshift → Aurora dentro de la VPC',
      );
      this.redshiftSecurityGroup.addIngressRule(
        this.redshiftSecurityGroup,
        ec2.Port.tcp(5439),
        'Redshift internal',
      );
    }

    // ── Outputs ──────────────────────────────────
    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
    });

    new cdk.CfnOutput(this, 'DemoMode', {
      value: String(props.demoMode),
      description: 'true = public subnets sin NAT, false = isolated + NAT',
    });
  }
}
