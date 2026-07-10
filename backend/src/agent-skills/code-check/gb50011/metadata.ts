export const GB50011_CANONICAL_CODE = 'GB50011';

export const GB50011_DISPLAY_CODE = 'GB 55002-2021 + GB/T 50011-2010 (2024 partial revision)';

export const GB50011_CODE_VERSION = 'v2-global-seismic-gb55002-gbt50011-2024';

export const GB50011_CODE_BASIS = [
  {
    code: 'GB 55002-2021',
    role: 'mandatory-seismic-general-code',
    effectiveDate: '2022-01-01',
  },
  {
    code: 'GB/T 50011-2010',
    role: 'seismic-design-standard',
    edition: '2024 partial revision',
    effectiveDate: '2024-08-01',
  },
] as const;

export function buildGB50011CodeCheckMetadata(): Record<string, unknown> {
  return {
    code: GB50011_CANONICAL_CODE,
    displayCode: GB50011_DISPLAY_CODE,
    codeVersion: GB50011_CODE_VERSION,
    codeBasis: GB50011_CODE_BASIS.map((entry) => ({ ...entry })),
  };
}

export function withGB50011CodeCheckMetadata<T extends Record<string, unknown>>(context: T): T & Record<string, unknown> {
  return {
    ...context,
    ...buildGB50011CodeCheckMetadata(),
  };
}
