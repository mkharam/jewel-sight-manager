-- Seed mock auth users so profiles FK is satisfied. Using a deterministic instance_id and minimal columns.
DO $$
DECLARE
  v_users uuid[] := ARRAY[
    '11111111-1111-1111-1111-111111111101'::uuid,
    '11111111-1111-1111-1111-111111111102'::uuid,
    '11111111-1111-1111-1111-111111111103'::uuid,
    '11111111-1111-1111-1111-111111111104'::uuid,
    '11111111-1111-1111-1111-111111111105'::uuid
  ];
  v_emails text[] := ARRAY['ahmed','salem','mona','youssef','laila'];
  i int;
BEGIN
  FOR i IN 1..array_length(v_users,1) LOOP
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous
    )
    VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_users[i],
      'authenticated','authenticated',
      v_emails[i] || '@lamaa.local',
      crypt('1234', gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb, false, false
    )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;
END $$;

-- Insert/upsert mock profiles (handle_new_user trigger may have made some already)
INSERT INTO profiles (id, full_name, branch_id, phone) VALUES
('11111111-1111-1111-1111-111111111101', 'أحمد المبروك', '1bb8b480-34bc-4d6f-9fea-983cc83dd58a', '0911000001'),
('11111111-1111-1111-1111-111111111102', 'سالم الفيتوري', '05e96f01-e84f-4fe5-8a75-2a9414cad402', '0911000002'),
('11111111-1111-1111-1111-111111111103', 'منى التواتي', '100069f7-d8bc-4c5f-b87f-f2f6881165ef', '0911000003'),
('11111111-1111-1111-1111-111111111104', 'يوسف الشريف', '4d103741-cf3b-4553-8969-dbbe87d84c06', '0911000004'),
('11111111-1111-1111-1111-111111111105', 'ليلى القاضي', '8fb4895f-c2cd-4af9-9b44-7d92c1bfcfab', '0911000005')
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, branch_id = EXCLUDED.branch_id, phone = EXCLUDED.phone;

-- Roles: handle_new_user already inserted 'employee'; promote two of them to manager
DELETE FROM user_roles WHERE user_id = '11111111-1111-1111-1111-111111111101' AND role = 'employee';
INSERT INTO user_roles (user_id, role) VALUES
('11111111-1111-1111-1111-111111111101','manager') ON CONFLICT DO NOTHING;
DELETE FROM user_roles WHERE user_id = '11111111-1111-1111-1111-111111111104' AND role = 'employee';
INSERT INTO user_roles (user_id, role) VALUES
('11111111-1111-1111-1111-111111111104','manager') ON CONFLICT DO NOTHING;

-- Mock products
INSERT INTO products (id, name, karat, weight_grams, sale_price, branch_id, created_by, status, item_type, ring_size, description) VALUES
('22222222-2222-2222-2222-222222222201','خاتم خطوبة ألماس كلاسيكي','18',4.2,8500,'1bb8b480-34bc-4d6f-9fea-983cc83dd58a','11111111-1111-1111-1111-111111111101','available','خاتم','16','خاتم خطوبة فاخر بفص ألماس مركزي'),
('22222222-2222-2222-2222-222222222202','طقم عروس ذهب أصفر','21',38.5,24000,'05e96f01-e84f-4fe5-8a75-2a9414cad402','11111111-1111-1111-1111-111111111102','available','طقم',NULL,'طقم كامل: عقد + سوار + خاتم + حلق'),
('22222222-2222-2222-2222-222222222203','سلسال قلب','18',3.8,4200,'100069f7-d8bc-4c5f-b87f-f2f6881165ef','11111111-1111-1111-1111-111111111103','available','سلسال',NULL,'سلسال ذهب أبيض بدلاية قلب'),
('22222222-2222-2222-2222-222222222204','حلق لؤلؤ','18',2.5,2800,'4d103741-cf3b-4553-8969-dbbe87d84c06','11111111-1111-1111-1111-111111111104','reserved','حلق',NULL,'حلق لؤلؤ طبيعي'),
('22222222-2222-2222-2222-222222222205','سوار براسيلي','21',12.0,7500,'8fb4895f-c2cd-4af9-9b44-7d92c1bfcfab','11111111-1111-1111-1111-111111111105','available','سوار',NULL,'سوار براسيلي رفيع'),
('22222222-2222-2222-2222-222222222206','خاتم رجالي عقيق','18',6.8,3200,'1bb8b480-34bc-4d6f-9fea-983cc83dd58a','11111111-1111-1111-1111-111111111101','available','خاتم','20','خاتم رجالي بحجر عقيق يماني'),
('22222222-2222-2222-2222-222222222207','حلق ألماس قرط','18',3.1,6500,'05e96f01-e84f-4fe5-8a75-2a9414cad402','11111111-1111-1111-1111-111111111102','sold','حلق',NULL,'قرط ألماس صغير')
ON CONFLICT (id) DO NOTHING;

-- Mock quotes
INSERT INTO product_quotes (product_id, price, customer_name, customer_phone, branch_id, quoted_by, notes) VALUES
('22222222-2222-2222-2222-222222222201',8500,'أم محمد','0925555111','1bb8b480-34bc-4d6f-9fea-983cc83dd58a','11111111-1111-1111-1111-111111111101','طلبت السعر النهائي'),
('22222222-2222-2222-2222-222222222201',8200,'خالد بن علي','0925555222','1bb8b480-34bc-4d6f-9fea-983cc83dd58a','11111111-1111-1111-1111-111111111102','فاوض على السعر'),
('22222222-2222-2222-2222-222222222202',24000,'أهل العروس','0925555333','05e96f01-e84f-4fe5-8a75-2a9414cad402','11111111-1111-1111-1111-111111111102',NULL),
('22222222-2222-2222-2222-222222222203',4200,'فاطمة','0925555444','100069f7-d8bc-4c5f-b87f-f2f6881165ef','11111111-1111-1111-1111-111111111103','هدية'),
('22222222-2222-2222-2222-222222222205',7500,'سامي','0925555555','8fb4895f-c2cd-4af9-9b44-7d92c1bfcfab','11111111-1111-1111-1111-111111111105',NULL),
('22222222-2222-2222-2222-222222222206',3200,'محمد العربي','0925555666','1bb8b480-34bc-4d6f-9fea-983cc83dd58a','11111111-1111-1111-1111-111111111101',NULL);

-- Mock inquiries
INSERT INTO customer_inquiries (customer_name, customer_phone, description, desired_karat, budget, branch_id, created_by, product_id, status) VALUES
('عميل من النوفليين','0925666111','يبحث عن خاتم خطوبة ألماس قياس 16','18',9000,'4d103741-cf3b-4553-8969-dbbe87d84c06','11111111-1111-1111-1111-111111111104','22222222-2222-2222-2222-222222222201','pending'),
('عميل من القادسية','0925666222','سأل عن السلسال القلب','18',5000,'8fb4895f-c2cd-4af9-9b44-7d92c1bfcfab','11111111-1111-1111-1111-111111111105','22222222-2222-2222-2222-222222222203','pending'),
('عميل من جرابة','0925666333','يطلب طقم عروس بميزانية 25 ألف','21',25000,'1bb8b480-34bc-4d6f-9fea-983cc83dd58a','11111111-1111-1111-1111-111111111101',NULL,'pending');

-- Mock transfers
INSERT INTO transfers (product_id, product_name_snapshot, from_branch_id, to_branch_id, requested_by, status, reason, customer_name, approved_by, approved_at) VALUES
('22222222-2222-2222-2222-222222222201','خاتم خطوبة ألماس كلاسيكي','1bb8b480-34bc-4d6f-9fea-983cc83dd58a','4d103741-cf3b-4553-8969-dbbe87d84c06','11111111-1111-1111-1111-111111111104','in_transit','زبون يطلب القياس 16 من النوفليين','أم محمد','11111111-1111-1111-1111-111111111101', now() - interval '2 hours'),
('22222222-2222-2222-2222-222222222203','سلسال قلب','100069f7-d8bc-4c5f-b87f-f2f6881165ef','8fb4895f-c2cd-4af9-9b44-7d92c1bfcfab','11111111-1111-1111-1111-111111111105','pending','الزبونة تفضل التسوق في القادسية','فاطمة',NULL,NULL),
('22222222-2222-2222-2222-222222222205','سوار براسيلي','8fb4895f-c2cd-4af9-9b44-7d92c1bfcfab','05e96f01-e84f-4fe5-8a75-2a9414cad402','11111111-1111-1111-1111-111111111102','received','تجميع طقم لزبونة',NULL,'11111111-1111-1111-1111-111111111105', now() - interval '1 day'),
('22222222-2222-2222-2222-222222222204','حلق لؤلؤ','4d103741-cf3b-4553-8969-dbbe87d84c06','100069f7-d8bc-4c5f-b87f-f2f6881165ef','11111111-1111-1111-1111-111111111103','approved','زبونة بنعاشور تريد تجربته',NULL,'11111111-1111-1111-1111-111111111104', now() - interval '30 minutes');

-- Activity log
INSERT INTO activity_log (actor_id, action, entity_type, entity_id, details) VALUES
('11111111-1111-1111-1111-111111111101','create','product','22222222-2222-2222-2222-222222222201','{"name":"خاتم خطوبة ألماس كلاسيكي"}'),
('11111111-1111-1111-1111-111111111102','create','product','22222222-2222-2222-2222-222222222202','{"name":"طقم عروس ذهب أصفر"}'),
('11111111-1111-1111-1111-111111111101','quote','product','22222222-2222-2222-2222-222222222201','{"price":8500,"customer":"أم محمد"}'),
('11111111-1111-1111-1111-111111111104','transfer_request','transfer',NULL,'{"product":"خاتم خطوبة ألماس كلاسيكي"}'),
('11111111-1111-1111-1111-111111111101','transfer_approve','transfer',NULL,'{"product":"خاتم خطوبة ألماس كلاسيكي"}');