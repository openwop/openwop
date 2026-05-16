/**
 * Mask a credential for display. `"sk-ant-api03-AbCdEfGh…XyZ4"` style:
 * 4 leading chars, ellipsis, 4 trailing chars. For shorter strings,
 * just hide entirely. Borrowed from MyndHyve's `BYOKCloudSyncService.maskApiKey()`.
 */
export function maskApiKey(value: string): string {
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
