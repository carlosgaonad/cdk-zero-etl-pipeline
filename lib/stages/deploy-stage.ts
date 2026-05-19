import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NetworkingStack } from '../stacks/networking-stack';
import { AuroraStack } from '../stacks/aurora-stack';
import { RedshiftStack } from '../stacks/redshift-stack';
import { ZeroEtlStack } from '../stacks/zero-etl-stack';

export interface DeployStageProps extends cdk.StageProps {
  readonly demoMode: boolean;
  readonly myIpCidr?: string;
}

/**
 * Stage que agrupa los 4 stacks de la plataforma analítica.
 *
 * Orden de despliegue (resuelto por CDK desde las cross-stack references):
 *   Networking → Aurora & Redshift (en paralelo) → ZeroEtl
 */
export class DeployStage extends cdk.Stage {
  constructor(scope: Construct, id: string, props: DeployStageProps) {
    super(scope, id, props);

    // ── 1. Networking ─────────────────────────────
    const networking = new NetworkingStack(this, 'NetworkingStack', {
      env: props.env,
      description: 'VPC, subnets, y security groups',
      demoMode: props.demoMode,
      myIpCidr: props.myIpCidr,
    });

    // ── 2. Aurora PostgreSQL ──────────────────────
    const aurora = new AuroraStack(this, 'AuroraStack', {
      env: props.env,
      description: 'Aurora PostgreSQL provisioned (fuente Zero-ETL)',
      vpc: networking.vpc,
      auroraSecurityGroup: networking.auroraSecurityGroup,
      demoMode: props.demoMode,
    });
    aurora.addDependency(networking);

    // ── 3. Redshift Serverless ────────────────────
    const redshift = new RedshiftStack(this, 'RedshiftStack', {
      env: props.env,
      description: 'Redshift Serverless namespace + workgroup (destino Zero-ETL)',
      vpc: networking.vpc,
      redshiftSecurityGroup: networking.redshiftSecurityGroup,
      demoMode: props.demoMode,
    });
    redshift.addDependency(networking);

    // ── 4. Zero-ETL Integration ───────────────────
    const zeroEtl = new ZeroEtlStack(this, 'ZeroEtlStack', {
      env: props.env,
      description: 'Integración Zero-ETL: Aurora PostgreSQL → Redshift',
      sourceArn: aurora.clusterArn,
      redshiftNamespaceArn: redshift.namespaceArn,
      redshiftNamespaceName: redshift.namespaceName,
    });
    zeroEtl.addDependency(aurora);
    zeroEtl.addDependency(redshift);
  }
}
