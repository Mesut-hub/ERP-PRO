import { VatRateCode } from '@prisma/client';

export function vatRateFromCode(code: VatRateCode): number {
  // Adjust to your real enum values
  switch (code) {
    case 'KDV_0':
      return 0;
    case 'KDV_1':
      return 1;
    case 'KDV_10':
      return 10;
    case 'KDV_20':
      return 20;
    default:
      // If you add more codes later, update here
      return 0;
  }
}
