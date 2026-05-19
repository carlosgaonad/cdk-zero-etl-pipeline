import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { NetworkingStack } from '../lib/stacks/networking-stack';
import { AuroraStack } from '../lib/stacks/aurora-stack';
import { RedshiftStack } from '../lib/stacks/redshift-stack';
import { ZeroEtlStack } from '../lib/stacks/zero-etl-stack';
import { PipelineStack } from '../lib/pipeline-stack';

const env = { account: '123456789012', region: 'us-east-1' };

// ──────────────────────────────────────────────────────────────────
// NetworkingStack
// ──────────────────────────────────────────────────────────────────
describe('NetworkingStack (demoMode = true)', () => {
  const app = new cdk.App();
  const stack = new NetworkingStack(app, 'TestNet-Demo', {
    env,
    demoMode: true,
    myIpCidr: '1.2.3.4/32',
  });
  const template = Template.fromStack(stack);

  test('crea exactamente 1 VPC', () => {
    template.resourceCountIs('AWS::EC2::VPC', 1);
  });

  test('NO crea NAT Gateways en modo demo', () => {
    template.resourceCountIs('AWS::EC2::NatGateway', 0);
  });

  test('crea 3 public subnets en modo demo (Redshift Serverless requiere min 2 AZ, usamos 3 para compat)', () => {
    template.resourceCountIs('AWS::EC2::Subnet', 3);
  });

  test('SG de Aurora autoriza puerto 5432 desde la IP del usuario', () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      SecurityGroupIngress: Match.arrayWith([
        Match.objectLike({
          IpProtocol: 'tcp',
          FromPort: 5432,
          ToPort: 5432,
          CidrIp: '1.2.3.4/32',
        }),
      ]),
    });
  });

  test('SG de Redshift autoriza puerto 5439 desde la IP del usuario', () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      SecurityGroupIngress: Match.arrayWith([
        Match.objectLike({
          IpProtocol: 'tcp',
          FromPort: 5439,
          ToPort: 5439,
          CidrIp: '1.2.3.4/32',
        }),
      ]),
    });
  });
});

describe('NetworkingStack (demoMode = false / producción)', () => {
  const app = new cdk.App();
  const stack = new NetworkingStack(app, 'TestNet-Prod', {
    env,
    demoMode: false,
  });
  const template = Template.fromStack(stack);

  test('crea NAT Gateways (1 por AZ)', () => {
    template.resourceCountIs('AWS::EC2::NatGateway', 3);
  });

  test('crea 3 capas de subnets en 3 AZ (9 subnets)', () => {
    template.resourceCountIs('AWS::EC2::Subnet', 9);
  });
});

// ──────────────────────────────────────────────────────────────────
// AuroraStack
// ──────────────────────────────────────────────────────────────────
describe('AuroraStack', () => {
  const app = new cdk.App();
  const networking = new NetworkingStack(app, 'TestNet-Aurora', {
    env,
    demoMode: true,
    myIpCidr: '1.2.3.4/32',
  });
  const stack = new AuroraStack(app, 'TestAurora', {
    env,
    vpc: networking.vpc,
    auroraSecurityGroup: networking.auroraSecurityGroup,
    demoMode: true,
  });
  const template = Template.fromStack(stack);

  test('crea un cluster Aurora con engine PostgreSQL', () => {
    template.resourceCountIs('AWS::RDS::DBCluster', 1);
    template.hasResourceProperties('AWS::RDS::DBCluster', {
      Engine: 'aurora-postgresql',
    });
  });

  test('una sola instancia (writer) sin readers', () => {
    template.resourceCountIs('AWS::RDS::DBInstance', 1);
  });

  test('usa db.t4g.medium (la mas pequeña permitida en Aurora PG)', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      DBInstanceClass: 'db.t4g.medium',
    });
  });

  test('encriptación de almacenamiento activa', () => {
    template.hasResourceProperties('AWS::RDS::DBCluster', {
      StorageEncrypted: true,
    });
  });

  test('parameter group con enhanced_logical_replication para Zero-ETL', () => {
    template.hasResourceProperties('AWS::RDS::DBClusterParameterGroup', {
      Parameters: Match.objectLike({
        'rds.logical_replication': '1',
        'aurora.enhanced_logical_replication': '1',
      }),
    });
  });

  test('writer es publiclyAccessible en modo demo', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      PubliclyAccessible: true,
    });
  });

  test('NO usa Serverless v2 (es provisioned)', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      DBInstanceClass: Match.not('db.serverless'),
    });
  });
});

// ──────────────────────────────────────────────────────────────────
// RedshiftStack
// ──────────────────────────────────────────────────────────────────
describe('RedshiftStack', () => {
  const app = new cdk.App();
  const networking = new NetworkingStack(app, 'TestNet-Redshift', {
    env,
    demoMode: true,
    myIpCidr: '1.2.3.4/32',
  });
  const stack = new RedshiftStack(app, 'TestRedshift', {
    env,
    vpc: networking.vpc,
    redshiftSecurityGroup: networking.redshiftSecurityGroup,
    demoMode: true,
  });
  const template = Template.fromStack(stack);

  test('crea un namespace de Redshift Serverless', () => {
    template.resourceCountIs('AWS::RedshiftServerless::Namespace', 1);
  });

  test('crea un workgroup de Redshift Serverless', () => {
    template.resourceCountIs('AWS::RedshiftServerless::Workgroup', 1);
  });

  test('namespace usa manageAdminPassword (no hardcodeado)', () => {
    template.hasResourceProperties('AWS::RedshiftServerless::Namespace', {
      ManageAdminPassword: true,
    });
  });

  test('workgroup tiene case sensitivity habilitado (clave Zero-ETL)', () => {
    template.hasResourceProperties('AWS::RedshiftServerless::Workgroup', {
      ConfigParameters: Match.arrayWith([
        Match.objectLike({
          ParameterKey: 'enable_case_sensitive_identifier',
          ParameterValue: 'true',
        }),
      ]),
    });
  });

  test('workgroup es publiclyAccessible en modo demo', () => {
    template.hasResourceProperties('AWS::RedshiftServerless::Workgroup', {
      PubliclyAccessible: true,
    });
  });
});

// ──────────────────────────────────────────────────────────────────
// ZeroEtlStack
// ──────────────────────────────────────────────────────────────────
describe('ZeroEtlStack', () => {
  const app = new cdk.App();
  const stack = new ZeroEtlStack(app, 'TestZeroEtl', {
    env,
    sourceArn: 'arn:aws:rds:us-east-1:123456789012:cluster:test-cluster',
    redshiftNamespaceArn:
      'arn:aws:redshift-serverless:us-east-1:123456789012:namespace/test-ns-id',
    redshiftNamespaceName: 'test-ns',
  });
  const template = Template.fromStack(stack);

  test('crea un recurso AWS::RDS::Integration', () => {
    template.resourceCountIs('AWS::RDS::Integration', 1);
  });

  test('integración tiene los ARNs correctos', () => {
    template.hasResourceProperties('AWS::RDS::Integration', {
      SourceArn: 'arn:aws:rds:us-east-1:123456789012:cluster:test-cluster',
      TargetArn:
        'arn:aws:redshift-serverless:us-east-1:123456789012:namespace/test-ns-id',
    });
  });

  test('crea un Custom Resource para PutResourcePolicy', () => {
    template.hasResourceProperties('Custom::AWS', {
      Create: Match.stringLikeRegexp('putResourcePolicy'),
    });
  });

  test('resource policy usa acción correcta redshift:AuthorizeInboundIntegration', () => {
    template.hasResourceProperties('Custom::AWS', {
      Create: Match.stringLikeRegexp('redshift:AuthorizeInboundIntegration'),
    });
  });
});

// ──────────────────────────────────────────────────────────────────
// PipelineStack
// ──────────────────────────────────────────────────────────────────
describe('PipelineStack', () => {
  const app = new cdk.App();
  const stack = new PipelineStack(app, 'TestPipeline', {
    env,
    githubOwner: 'tu-usuario',
    githubRepo: 'cdk-zero-etl-pipeline',
    githubBranch: 'main',
    githubTokenSecretName: 'github-token',
    demoMode: true,
    myIpCidr: '1.2.3.4/32',
  });
  const template = Template.fromStack(stack);

  test('crea un CodePipeline', () => {
    template.resourceCountIs('AWS::CodePipeline::Pipeline', 1);
  });

  test('al menos un proyecto de CodeBuild', () => {
    const count = Object.keys(
      template.findResources('AWS::CodeBuild::Project'),
    ).length;
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
