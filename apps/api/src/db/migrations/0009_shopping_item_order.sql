/*
 Kolejność pozycji listy zakupów w dziale, ustawiana przeciąganiem (ADR-104, 03 §3.25).
 Istniejące pozycje dostają kolejność dopisania w obrębie listy — ekran wygląda tak samo
 jak przed migracją (07 §14.6: dotąd w dziale wg created_at).
*/
ALTER TABLE `shopping_items` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `shopping_items` SET `sort_order` = (
  SELECT count(*) FROM `shopping_items` AS `earlier`
  WHERE `earlier`.`list_id` = `shopping_items`.`list_id`
    AND (`earlier`.`created_at` < `shopping_items`.`created_at`
      OR (`earlier`.`created_at` = `shopping_items`.`created_at` AND `earlier`.`id` < `shopping_items`.`id`))
);
