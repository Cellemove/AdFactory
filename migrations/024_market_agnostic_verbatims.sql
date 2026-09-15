-- Migration 024: verbatims with market = NULL are market-AGNOSTIC, not
-- market-less. Nearly the whole corpus is mined without a market tag, so the
-- old strict match ("upper(v.market) = upper(filter_market)") made the
-- scorer's grounding module report "needs evidence" for every market despite
-- hundreds of embedded verbatims. NULL now matches any scoring market;
-- market-tagged rows still only match their own market. Idempotent.

create or replace function match_verbatims(
  query_embedding extensions.vector(768),
  match_count integer default 5,
  filter_sub_avatar_id text default null,
  filter_angle_slug text default null,
  filter_market text default null
)
returns table (
  id text,
  text text,
  "sourceUrl" text,
  similarity double precision
)
language sql
stable
as $$
  select
    v.id,
    v.text,
    v."sourceUrl",
    1 - (v.embedding <=> query_embedding) as similarity
  from "Verbatim" v
  where v.embedding is not null
    and v."researchId" like 'verified:%'
    and (filter_sub_avatar_id is null or v."subAvatarId" = filter_sub_avatar_id)
    and (filter_angle_slug is null or v."angleSlug" = filter_angle_slug)
    and (filter_market is null or v.market is null or upper(v.market) = upper(filter_market))
  order by v.embedding <=> query_embedding
  limit greatest(1, least(match_count, 50));
$$;
