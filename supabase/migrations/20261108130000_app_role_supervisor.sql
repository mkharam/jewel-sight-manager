-- دور «مشرف عام» تحت الإدارة: يشوف كل الفروع ويدير البضاعة والتحويلات والاستفسارات والجرد والصيانة
-- والتقييم، لكن بلا مبيعات أمارسوفت ولا أرقام فلوس (كلها تبقى has_role 'admin' بس).
alter type public.app_role add value if not exists 'supervisor' before 'manager';
