#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DeployStage } from '../lib/stages/deploy-stage';
import { PipelineStack } from '../lib/pipeline-stack';

const app = new cdk.App();

// ============================================================================
// CONFIGURACIÓN
// ============================================================================
// Todos los flags se leen del contexto CDK. Defaults en cdk.json.
//
// Override por CLI:
//   cdk deploy -c demoMode=true -c usePipeline=false -c myIp=$(curl -s ifconfig.me)/32
//
// Override por variable de entorno (útil en CI):
//   MY_IP_CIDR=190.x.x.x/32 cdk deploy ...
// ============================================================================

const demoMode = app.node.tryGetContext('demoMode') !== 'false'; // default: true
const usePipeline = app.node.tryGetContext('usePipeline') === 'true'; // default: false
const myIpCidr =
  app.node.tryGetContext('myIp') ?? process.env.MY_IP_CIDR ?? undefined;

if (demoMode && !myIpCidr) {
  console.warn(
    '\n⚠️  DEMO MODE sin IP restringida.\n' +
      '   Los security groups quedarán SIN reglas de ingress.\n' +
      '   Para abrir solo a tu IP: cdk deploy -c myIp=$(curl -s ifconfig.me)/32\n',
  );
}

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

if (usePipeline) {
  // ============================================================================
  // MODO PIPELINE — self-mutating CodePipeline
  // ============================================================================
  // Solo despliegas este stack una vez. Luego cada git push lo actualiza todo.
  //
  // Pre-requisito: secret 'github-token' en Secrets Manager con un PAT.
  // ============================================================================

  // ⚠️ AJUSTA estos valores con los datos de tu repo:
  const githubOwner =
    app.node.tryGetContext('githubOwner') ?? process.env.GITHUB_OWNER ?? 'TU_USUARIO';
  const githubRepo =
    app.node.tryGetContext('githubRepo') ?? process.env.GITHUB_REPO ?? 'cdk-zero-etl-pipeline';
  const githubBranch =
    app.node.tryGetContext('githubBranch') ?? process.env.GITHUB_BRANCH ?? 'main';
  const githubTokenSecretName =
    app.node.tryGetContext('githubTokenSecret') ??
    process.env.GITHUB_TOKEN_SECRET ??
    'github-token';

  new PipelineStack(app, 'CdkZeroEtl-Pipeline', {
    env,
    description: 'Self-mutating CDK Pipeline para Aurora + Redshift Zero-ETL',
    githubOwner,
    githubRepo,
    githubBranch,
    githubTokenSecretName,
    demoMode,
    myIpCidr,
  });
} else {
  // ============================================================================
  // MODO DIRECTO — deploy local de los 4 stacks
  // ============================================================================
  // Más simple para demos y desarrollo. Cada `cdk deploy` aplica los cambios.
  // ============================================================================

  new DeployStage(app, 'CdkZeroEtl', {
    env,
    demoMode,
    myIpCidr,
  });
}

app.synth();
