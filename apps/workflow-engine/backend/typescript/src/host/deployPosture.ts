export type DeployPosture = 'bearer-shared' | 'cookie-per-visitor' | 'auth';

export function readDeployPosture(): DeployPosture {
  const raw = process.env.OPENWOP_DEPLOY_POSTURE;
  if (raw === 'bearer-shared' || raw === 'cookie-per-visitor' || raw === 'auth') {
    return raw;
  }
  return process.env.OPENWOP_AUTH_ENFORCE_BEARER === 'true' ? 'auth' : 'cookie-per-visitor';
}

export function managedAnonSignInRequired(): boolean {
  const explicit = process.env.OPENWOP_MANAGED_ANON_SIGNIN_REQUIRED;
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return readDeployPosture() === 'auth';
}
