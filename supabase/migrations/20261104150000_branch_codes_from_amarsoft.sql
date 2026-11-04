-- Branch numbers and names as Amarsoft has them (co_para.CODE / CONAME in each branch folder).
-- Three branches had the placeholder code 'BRA'; they have no products yet, so no SKU changes.
-- The number goes in front of the name so it shows next to the branch everywhere and lists sort by it.
update public.branches b
set code = m.code,
    name = m.code || ' - ' || regexp_replace(b.name, '^\d+\s*-\s*', ''),
    name_en = v.en
from public.amarsoft_branch_map m
join (values ('01','Andalus'),('02','Qadisiyah'),('03','Jaraba'),('04','Bin-Ashur'),('05','Nawfalin')) v(code, en) on v.code = m.code
where m.branch_id = b.id;
