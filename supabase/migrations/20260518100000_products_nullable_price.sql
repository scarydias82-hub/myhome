-- Some retailers (Poliform, luxury houses) list "POA / showroom only" with no
-- visible price. We still want them in the catalogue for visual matching, so
-- allow null prices and have the UI render "POA" for missing values.

alter table public.products
  alter column price_aud drop not null;
