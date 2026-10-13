-- Cricket fixtures belong to a stage: the group stage or the playoffs. League tournaments (IPL)
-- upload them separately; playoff fixture numbers continue from the group stage's last.
-- Every existing fixture is group stage. Additive: apply with scripts/apply-0028-cricket-fixture-stage.mjs.
ALTER TABLE `cricket_fixtures` ADD `stage` text DEFAULT 'group' NOT NULL;
