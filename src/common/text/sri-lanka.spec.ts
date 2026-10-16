import { normalizeNic, normalizeSriLankanPhone } from './sri-lanka.js';

describe('normalizeSriLankanPhone', () => {
  it.each([
    ['0771234567', '+94771234567'],
    ['771234567', '+94771234567'],
    ['94771234567', '+94771234567'],
    ['+94771234567', '+94771234567'],
    [' 077-123 4567 ', '+94771234567'],
    ['(011) 2345678', '+94112345678'],
  ])('normalises %s', (input, expected) => {
    expect(normalizeSriLankanPhone(input)).toBe(expected);
  });

  it.each([
    '',
    '12345',
    '+1 202 555 0100',
    '00771234567',
    '0071234567',
    '+940771234567',
  ])('rejects %s', (input) => {
    expect(normalizeSriLankanPhone(input)).toBeNull();
  });
});

describe('normalizeNic', () => {
  it.each([
    [' 901234567v ', '901234567V'],
    ['901234567X', '901234567X'],
    ['199012345678', '199012345678'],
  ])('normalises %s', (input, expected) => {
    expect(normalizeNic(input)).toBe(expected);
  });

  it.each(['12345', '901234567A', '1990123456789', '90123456V'])(
    'rejects %s',
    (input) => {
      expect(normalizeNic(input)).toBeNull();
    },
  );
});
