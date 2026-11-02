import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';
import {
  NIC_PATTERN,
  SRI_LANKAN_PHONE_PATTERN,
  normalizeNic,
  normalizeSriLankanPhone,
} from '../text/sri-lanka.js';

/**
 * A Sri Lankan phone number, normalised to +94XXXXXXXXX. Invalid input is
 * left as-is so the pattern check rejects it with a clear message.
 */
export const IsSriLankanPhone = () =>
  applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string'
        ? (normalizeSriLankanPhone(value) ?? value)
        : value,
    ),
    IsString(),
    Matches(SRI_LANKAN_PHONE_PATTERN, {
      message:
        'phone must be a valid Sri Lankan number, e.g. 0771234567 or +94771234567',
    }),
  );

/** A Sri Lankan NIC (old 9 digits + V/X, or new 12 digits), uppercased. */
export const IsNic = () =>
  applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? (normalizeNic(value) ?? value) : value,
    ),
    IsString(),
    Matches(NIC_PATTERN, {
      message: 'nic must be 9 digits followed by V/X, or 12 digits',
    }),
  );
