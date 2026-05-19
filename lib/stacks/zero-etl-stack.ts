import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

export interface ZeroEtlStackProps extends cdk.StackProps {
  readonly sourceArn: string;
  readonly redshiftNamespaceArn: string;
  readonly redshiftNamespaceName: string;
}

/**
 * Crea la integración Zero-ETL entre RDS PostgreSQL y Redshift Serverless.
 *
 * Dos pasos:
 *
 *   1) Resource policy en el namespace de Redshift que autoriza a la
 *      instancia RDS como fuente. Usamos AwsCustomResource → putResourcePolicy
 *      en lugar de incluir la policy en CfnNamespace porque permite
 *      actualizarla sin recrear el namespace.
 *
 *   2) AWS::RDS::Integration (CfnIntegration): la replicación real.
 *      sourceArn = RDS instance, targetArn = Redshift namespace.
 *
 * IMPORTANTE — acción correcta:
 *   La acción IAM es `redshift:AuthorizeInboundIntegration` (sin "-serverless").
 *   Es un error común poner "redshift-serverless:..." y la integración falla
 *   silenciosamente, queda en estado "Failed" sin mensaje claro.
 *
 * Último paso manual (no automatizable desde CFN):
 *   CREATE DATABASE aurora_data FROM INTEGRATION '<integration-id>' DATABASE demodb;
 */
export class ZeroEtlStack extends cdk.Stack {
  public readonly integrationArn: string;

  constructor(scope: Construct, id: string, props: ZeroEtlStackProps) {
    super(scope, id, props);

    const accountId = cdk.Stack.of(this).account;

    // ── Paso 1: Resource policy en el namespace ──
    const resourcePolicyDocument = JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'AllowRdsIntegrationSource',
          Effect: 'Allow',
          Principal: { Service: 'redshift.amazonaws.com' },
          Action: 'redshift:AuthorizeInboundIntegration',
          Condition: {
            StringEquals: {
              'aws:SourceArn': props.sourceArn,
            },
          },
        },
        {
          Sid: 'AllowAccountToCreateInbound',
          Effect: 'Allow',
          Principal: { AWS: `arn:aws:iam::${accountId}:root` },
          Action: 'redshift:CreateInboundIntegration',
        },
      ],
    });

    const putResourcePolicy = new cr.AwsCustomResource(
      this,
      'PutResourcePolicy',
      {
        onCreate: {
          service: 'RedshiftServerless',
          action: 'putResourcePolicy',
          parameters: {
            resourceArn: props.redshiftNamespaceArn,
            policy: resourcePolicyDocument,
          },
          physicalResourceId: cr.PhysicalResourceId.of(
            `rp-${props.redshiftNamespaceName}`,
          ),
        },
        onUpdate: {
          service: 'RedshiftServerless',
          action: 'putResourcePolicy',
          parameters: {
            resourceArn: props.redshiftNamespaceArn,
            policy: resourcePolicyDocument,
          },
          physicalResourceId: cr.PhysicalResourceId.of(
            `rp-${props.redshiftNamespaceName}`,
          ),
        },
        // No borramos la policy en onDelete: si la integración aún existe,
        // el delete fallaría. Es seguro dejar la policy huérfana — CDK
        // borra el namespace y se va con ella.
        policy: cr.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            actions: [
              'redshift-serverless:PutResourcePolicy',
              'redshift-serverless:GetResourcePolicy',
            ],
            resources: [props.redshiftNamespaceArn],
          }),
        ]),
        installLatestAwsSdk: false,
      },
    );

    // ── Paso 2: La integración Zero-ETL ──
    const integration = new rds.CfnIntegration(this, 'ZeroEtlIntegration', {
      integrationName: 'rds-pg-to-redshift-zero-etl',
      sourceArn: props.sourceArn,
      targetArn: props.redshiftNamespaceArn,
      // dataFilter opcional: replicar solo ciertas tablas.
      // dataFilter: 'include: demodb.public.*',
    });

    // La integración debe esperar a que la policy esté lista.
    integration.node.addDependency(putResourcePolicy);

    this.integrationArn = integration.attrIntegrationArn;

    // ── Outputs ─────────────────────────────────
    new cdk.CfnOutput(this, 'IntegrationArn', {
      value: integration.attrIntegrationArn,
    });

    new cdk.CfnOutput(this, 'NextStep', {
      value:
        'En Redshift: CREATE DATABASE aurora_data FROM INTEGRATION \'<id>\' DATABASE demodb;',
      description: 'Paso manual obligatorio para activar la integración',
    });
  }
}
