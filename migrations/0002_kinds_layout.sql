-- v2: user-defined account kinds, account order + note. (0001 is never edited.)
CREATE TABLE IF NOT EXISTS account_kinds (
  key TEXT PRIMARY KEY,                     -- ^[a-z][a-z0-9_]{1,31}$
  name TEXT NOT NULL,
  color TEXT NOT NULL,                      -- #rrggbb
  liquidity TEXT NOT NULL,                  -- 'liquid' | 'invest' | 'fixed' | 'liability'
  sort INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO account_kinds VALUES
  ('bank','銀行','#2a78d6','liquid',0), ('tw_stock','台股','#eb6834','invest',1),
  ('us_stock','美股','#1baf7a','invest',2), ('crypto','加密貨幣','#4a3aa7','invest',3),
  ('movable','動產','#eda100','fixed',4), ('real_estate','不動產','#e87ba4','fixed',5),
  ('liability','負債','#e34948','liability',6);
ALTER TABLE accounts ADD COLUMN sort INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN note TEXT NOT NULL DEFAULT '';
