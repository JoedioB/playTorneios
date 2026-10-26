\set ON_ERROR_STOP on
-- Verificação do SQL contra um Postgres real. Em CI: psql -f migrations/001_init.sql && psql -f test/db-check.sql (a transação termina em ROLLBACK).
begin;
insert into organizations(id,name) values ('11111111-1111-1111-1111-111111111111','O1'),('22222222-2222-2222-2222-222222222222','O2') on conflict do nothing;
-- putState (tournament_states upsert)
insert into tournament_states(tournament_id, organization_id, state) values ('t-aaa','11111111-1111-1111-1111-111111111111','{"x":1}') on conflict (tournament_id) do update set state = excluded.state, updated_at = now();
insert into tournament_states(tournament_id, organization_id, state) values ('t-bbb','22222222-2222-2222-2222-222222222222','{}') on conflict (tournament_id) do update set state = excluded.state, updated_at = now();
-- slug logic: org2 wants same slug as org1 -> suffix
insert into tournament_slugs(slug, tournament_id) values ('open','t-aaa') on conflict (tournament_id) do update set slug = excluded.slug;
select tournament_id from tournament_slugs where slug = 'open' and tournament_id <> 't-bbb';
insert into tournament_slugs(slug, tournament_id) values ('open-tbbb','t-bbb') on conflict (tournament_id) do update set slug = excluded.slug;
-- applied ops with tournament id
insert into applied_operations(device_id, op_id, tournament_id, result) values ('d','o1','t-aaa','{}') on conflict (device_id, op_id) do update set result = excluded.result;
-- versions
insert into entity_versions(key, version) values ('t-aaa/court/q1', 1) on conflict (key) do update set version = entity_versions.version + 1 returning version;
insert into entity_versions(key, version) values ('t-bbb/court/q1', 1) on conflict (key) do update set version = entity_versions.version + 1;
insert into entity_changes(key, version, fields, device_id) values ('t-aaa/court/q1',1,array['name'],'d');
select key, version from entity_versions where starts_with(key, 't-aaa/');
-- curinga '%' não casa mais com outros torneios
select count(*) as vazamento_curinga from entity_versions where starts_with(key, '%/');
-- halts, conflicts
insert into sync_halts(device_id, key, op_id) values ('d','t-aaa/court/q1','o1') on conflict (device_id, key) do update set op_id = excluded.op_id;
insert into sync_conflicts(id, tournament_id, entity_key, status, record) values ('c1','t-aaa','t-aaa/court/q1','open','{}') on conflict (id) do update set status = excluded.status, record = excluded.record;
select c.record from sync_conflicts c join tournament_states t on t.tournament_id = c.tournament_id where c.tournament_id = 't-aaa' and t.organization_id = '11111111-1111-1111-1111-111111111111' and c.status = 'open' order by c.created_at;
select c.record from sync_conflicts c join tournament_states t on t.tournament_id = c.tournament_id where c.tournament_id = 't-aaa' and t.organization_id = '22222222-2222-2222-2222-222222222222';
update tournament_states set cursor = cursor + 1 where tournament_id = 't-aaa' and organization_id = '11111111-1111-1111-1111-111111111111' returning cursor;
-- snapshot + troca de slug (on update cascade)
insert into public_snapshots(slug, tournament_id, snapshot, etag) values ('open','t-aaa','{}','"e"');
update tournament_slugs set slug = 'novo' where tournament_id = 't-aaa';
select slug from public_snapshots where tournament_id = 't-aaa';
-- exclusão LGPD
delete from tournament_slugs where tournament_id = 't-aaa';
delete from sync_conflicts where tournament_id = 't-aaa';
delete from applied_operations where tournament_id = 't-aaa' or op_id in (select op_id from sync_halts where starts_with(key, 't-aaa/'));
delete from entity_changes where starts_with(key, 't-aaa/');
delete from entity_versions where starts_with(key, 't-aaa/');
delete from sync_halts where starts_with(key, 't-aaa/');
delete from tournament_states where tournament_id = 't-aaa';
select count(*) as outros_torneios_intactos from entity_versions where key = 't-bbb/court/q1';
select count(*) as snapshots_restantes from public_snapshots;

-- bloqueio de login atômico e purge de sessões
insert into users(id, organization_id, email, password_hash) values ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','a@b.c','x');
update users set failed_logins = 4 where id = '33333333-3333-3333-3333-333333333333';
update users set failed_logins = case when failed_logins + 1 >= 5 then 0 else failed_logins + 1 end, locked_until = case when failed_logins + 1 >= 5 then now() + ('15' || ' minutes')::interval else locked_until end where id = '33333333-3333-3333-3333-333333333333';
select failed_logins, locked_until > now() as bloqueado from users where id = '33333333-3333-3333-3333-333333333333';
insert into sessions(token_hash,user_id,expires_at,last_seen_at) values ('old','33333333-3333-3333-3333-333333333333', now() - interval '1 day', now()), ('ok','33333333-3333-3333-3333-333333333333', now() + interval '1 day', now());
delete from sessions where expires_at < now() or last_seen_at < now() - ('8' || ' hours')::interval;
select token_hash as sessoes_restantes from sessions;
-- limite de login por IP (migração 002)
insert into login_failures(ip, at) values ('1.2.3.4', now() - interval '70 minutes'), ('1.2.3.4', now() - interval '30 minutes'), ('1.2.3.4', now() - interval '5 minutes'), ('5.6.7.8', now());
select count(*)::int as falhas_na_janela, min(at) is not null as tem_primeira from login_failures where ip = '1.2.3.4' and at > now() - ('60' || ' minutes')::interval;
delete from login_failures where at < now() - interval '1 day';
select count(*)::int as linhas_depois_do_purge from login_failures;
rollback;
