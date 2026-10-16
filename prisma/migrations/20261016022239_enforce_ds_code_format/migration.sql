-- Hand-written: DS codes are "DS" followed by digits (e.g. DS119, DS1234).
-- Replaces the generic normalisation check with the exact format.
ALTER TABLE "tenants" DROP CONSTRAINT "tenants_ds_code_normalised_chk";
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_ds_code_format_chk"
  CHECK ("dsCode" ~ '^DS[0-9]{1,10}$');
