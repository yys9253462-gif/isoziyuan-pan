-- 分享标题说明：为每个取件码增加一条简短中文标题，随取件页一起展示
ALTER TABLE shares ADD COLUMN title TEXT NOT NULL DEFAULT '';