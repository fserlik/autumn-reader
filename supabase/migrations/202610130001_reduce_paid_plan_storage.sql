begin;

-- Reducing a plan limit never deletes existing books. Accounts already above
-- their allowance keep read/remove access; the existing reservation and commit
-- checks prevent new uploads until usage returns below the plan limit.
update private.plan_catalog
set cloud_bytes = case code
  when 'plus' then 5368709120
  when 'pro' then 21474836480
  else cloud_bytes
end
where code in ('plus', 'pro');

commit;
