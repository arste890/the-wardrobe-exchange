export { formatUSD } from '@kw/shared/shipping';

export function cmToIn(cm: number): string {
  return (cm / 2.54).toFixed(1);
}

export function dateLong(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function plainText(md: string): string {
  return md.replace(/[#*_>`]+/g, '').replace(/\s+/g, ' ').trim();
}
