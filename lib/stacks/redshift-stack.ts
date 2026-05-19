import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as redshift from 'aws-cdk-lib/aws-redshiftserverless';
import { Construct } from 'constructs';

export interface RedshiftStackProps extends cdk.StackProps {
  readonly vpc: ec2.IVpc;
  readonly redshiftSecurityGroup: ec2.ISecurityGroup;
  /** Si true: subnets PUBLIC + publiclyAccessible. Si false: ISOLATED. */
  readonly demoMode: boolean;
}

/**
 * Redshift Serverless como DESTINO del Zero-ETL.
 *
 * Para la charla: aquí está el mensaje "sin miedo".
 * Redshift Serverless solo tiene constructs L1 (CfnNamespace, CfnWorkgroup).
 * L1 no es un downgrade, sigue siendo TypeScript con autocompletado y tipos.
 *
 * Parámetros OBLIGATORIOS para Zero-ETL:
 *   - enable_case_sensitive_identifier = true (en el workgroup)
 *   - Resource policy autorizando al cluster Aurora (se aplica desde ZeroEtlStack)
 */
export class RedshiftStack extends cdk.Stack {
  public readonly namespaceArn: string;
  public readonly namespaceName: string;
  public readonly workgroupName: string;
  public readonly workgroupEndpoint: string;

  constructor(scope: Construct, id: string, props: RedshiftStackProps) {
    super(scope, id, props);

    // ── IAM Role para Redshift ──────────────────
    const redshiftRole = new iam.Role(this, 'RedshiftRole', {
      assumedBy: new iam.ServicePrincipal('redshift.amazonaws.com'),
      description: 'Rol asumido por Redshift Serverless para acceso a datos',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'AmazonRedshiftAllCommandsFullAccess',
        ),
      ],
    });

    // ── Namespace ───────────────────────────────
    // manageAdminPassword=true → Redshift crea el secret en Secrets Manager
    // automáticamente. Mejor que un password hardcodeado.
    const namespace = new redshift.CfnNamespace(this, 'Namespace', {
      namespaceName: 'zero-etl-ns',
      adminUsername: 'rsadmin',
      manageAdminPassword: true,
      dbName: 'dev',
      defaultIamRoleArn: redshiftRole.roleArn,
      iamRoles: [redshiftRole.roleArn],
      logExports: ['userlog', 'connectionlog', 'useractivitylog'],
    });
    namespace.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // ── Workgroup ───────────────────────────────
    const subnets = props.vpc.selectSubnets({
      subnetType: props.demoMode
        ? ec2.SubnetType.PUBLIC
        : ec2.SubnetType.PRIVATE_ISOLATED,
    });

    const workgroup = new redshift.CfnWorkgroup(this, 'Workgroup', {
      workgroupName: 'zero-etl-wg',
      namespaceName: namespace.namespaceName!,
      baseCapacity: 8, // mínimo (8 RPU); algunas regiones permiten 4.
      securityGroupIds: [props.redshiftSecurityGroup.securityGroupId],
      subnetIds: subnets.subnetIds,
      publiclyAccessible: props.demoMode,
      configParameters: [
        {
          parameterKey: 'enable_case_sensitive_identifier',
          parameterValue: 'true',
        },
        {
          parameterKey: 'require_ssl',
          parameterValue: 'true',
        },
      ],
    });
    workgroup.addDependency(namespace);
    workgroup.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // ── Exponer valores para otros stacks ───────
    this.namespaceArn = namespace.attrNamespaceNamespaceArn;
    this.namespaceName = namespace.namespaceName!;
    this.workgroupName = workgroup.workgroupName;
    this.workgroupEndpoint = workgroup.attrWorkgroupEndpointAddress;

    // ── Outputs ─────────────────────────────────
    new cdk.CfnOutput(this, 'NamespaceArn', {
      value: namespace.attrNamespaceNamespaceArn,
    });

    new cdk.CfnOutput(this, 'WorkgroupEndpoint', {
      value: workgroup.attrWorkgroupEndpointAddress,
      description: 'Endpoint real del workgroup (no el nombre)',
    });

    new cdk.CfnOutput(this, 'WorkgroupPort', {
      value: cdk.Token.asString(workgroup.attrWorkgroupEndpointPort),
    });

    new cdk.CfnOutput(this, 'AdminSecretCommand', {
      value: `aws secretsmanager list-secrets --filters Key=tag-value,Values=${namespace.namespaceName}`,
      description: 'Comando para encontrar el ARN del secret auto-generado por manageAdminPassword. Filtra por el tag que Redshift agrega con el nombre del namespace.',
    });

    new cdk.CfnOutput(this, 'AdminSecretConsoleHint', {
      value: `Consola: Redshift → Serverless dashboard → Namespace ${namespace.namespaceName} → pestaña 'Actions' → 'View admin credentials' (o Secrets Manager → buscar "${namespace.namespaceName}")`,
      description: 'Alternativa por consola si prefieres no usar CLI',
    });
  }
}
