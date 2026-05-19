import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  CodePipeline,
  CodePipelineSource,
  ShellStep,
} from 'aws-cdk-lib/pipelines';
import { DeployStage } from './stages/deploy-stage';

export interface PipelineStackProps extends cdk.StackProps {
  readonly githubOwner: string;
  readonly githubRepo: string;
  readonly githubBranch: string;
  /** Nombre del secret en Secrets Manager que contiene el GitHub PAT. */
  readonly githubTokenSecretName: string;
  /** Modo de red para los stacks que se despliegan desde el pipeline. */
  readonly demoMode: boolean;
  /** En demoMode, IP/32 desde donde te conectas. */
  readonly myIpCidr?: string;
}

/**
 * Self-mutating CDK Pipeline.
 *
 * Flow:
 *   GitHub commit → Source → Synth (cdk synth) → SelfMutate → DeployStage
 *
 * Solo despliegas este stack UNA VEZ manualmente. Después, cada `git push`
 * dispara el pipeline y despliega los 4 stacks automáticamente.
 *
 * Pre-requisito: GitHub PAT guardado en Secrets Manager.
 *   aws secretsmanager create-secret \
 *     --name github-token \
 *     --secret-string "ghp_TU_TOKEN_AQUI"
 *
 * El PAT necesita scopes: `repo` y `admin:repo_hook`.
 */
export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    // ── Source: GitHub ────────────────────────────
    const source = CodePipelineSource.gitHub(
      `${props.githubOwner}/${props.githubRepo}`,
      props.githubBranch,
      {
        authentication: cdk.SecretValue.secretsManager(
          props.githubTokenSecretName,
        ),
      },
    );

    // ── Pipeline ──────────────────────────────────
    const pipeline = new CodePipeline(this, 'Pipeline', {
      pipelineName: 'ZeroEtlPipeline',
      crossAccountKeys: false, // single account → ahorra KMS
      selfMutation: true,
      synth: new ShellStep('Synth', {
        input: source,
        installCommands: ['npm ci'],
        commands: [
          'npm run build',
          // Importante: el pipeline también necesita los flags de contexto.
          `npx cdk synth -c demoMode=${props.demoMode} -c usePipeline=true -c githubOwner=${props.githubOwner} -c githubRepo=${props.githubRepo} -c githubBranch=${props.githubBranch} -c githubTokenSecret=${props.githubTokenSecretName}${
            props.myIpCidr ? ` -c myIp=${props.myIpCidr}` : ''
          }`,
        ],
      }),
    });

    // ── Stage: Deploy ─────────────────────────────
    pipeline.addStage(
      new DeployStage(this, 'Deploy', {
        env: props.env,
        demoMode: props.demoMode,
        myIpCidr: props.myIpCidr,
      }),
    );
  }
}
