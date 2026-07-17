-- 日誌（官網 Journal）：ERP 撰寫與發佈，官網透過 /api/journal 讀取
-- 內文為區塊式 jsonb 陣列，每個區塊：
--   { "type": "paragraph", "text": "…" }
--   { "type": "heading",   "text": "…" }
--   { "type": "quote",     "text": "…" }
--   { "type": "image",     "url": "…", "caption": "…"（選填）}
CREATE TABLE IF NOT EXISTS journal_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 文章編號（例：JN01），沿用官網現有 /journal/[id] 網址
  post_code text UNIQUE NOT NULL,
  -- 分類，對應官網 Journal 篩選（customer=客戶故事、work=工作紀錄、studio=工作室）
  tag text NOT NULL DEFAULT 'work' CHECK (tag IN ('customer', 'work', 'studio')),
  title_zh text NOT NULL,
  title_en text,
  -- 列表摘要
  excerpt_zh text,
  excerpt_en text,
  -- 文章顯示日期（非建立時間）
  post_date date NOT NULL DEFAULT CURRENT_DATE,
  -- 內文區塊陣列（雙語各一份）
  content_zh jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_en jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- 列表主圖 Public URL（journal-images bucket）與裁切焦點（CSS object-position）
  image_url text,
  object_position text,
  -- 官網發佈開關
  published boolean NOT NULL DEFAULT false,
  sort_order integer,
  -- 內部備註（不對官網公開）
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

COMMENT ON TABLE journal_posts IS '官網日誌文章：ERP 撰寫，published=true 時供官網 /api/journal 讀取';
COMMENT ON COLUMN journal_posts.post_code IS '文章編號（JN01…），官網網址 /journal/[post_code]';
COMMENT ON COLUMN journal_posts.content_zh IS '中文內文區塊陣列：paragraph/heading/quote（text）、image（url, caption）';
COMMENT ON COLUMN journal_posts.content_en IS '英文內文區塊陣列，結構同 content_zh';

CREATE INDEX IF NOT EXISTS journal_posts_published_idx
  ON journal_posts (post_date DESC) WHERE deleted_at IS NULL AND published = true;

-- updated_at 觸發器（沿用專案 per-table trigger 慣例）
CREATE OR REPLACE FUNCTION public.journal_posts_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS journal_posts_set_updated_at ON public.journal_posts;
CREATE TRIGGER journal_posts_set_updated_at
  BEFORE UPDATE ON public.journal_posts
  FOR EACH ROW
  EXECUTE PROCEDURE public.journal_posts_set_updated_at();

-- RLS：內部（已登入）完整存取；anon 僅能讀已發佈文章（官網 API 使用 anon key）
ALTER TABLE journal_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY journal_posts_authenticated_all ON journal_posts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY journal_posts_anon_read_published ON journal_posts
  FOR SELECT TO anon
  USING (published = true AND deleted_at IS NULL);

-- 建立公開 Storage bucket：journal-images（文章插圖與主圖）
INSERT INTO storage.buckets (id, name, public)
VALUES ('journal-images', 'journal-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "journal_images_upload" ON storage.objects;
DROP POLICY IF EXISTS "journal_images_update" ON storage.objects;
DROP POLICY IF EXISTS "journal_images_delete" ON storage.objects;
DROP POLICY IF EXISTS "journal_images_public_read" ON storage.objects;

CREATE POLICY "journal_images_upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'journal-images');

CREATE POLICY "journal_images_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'journal-images');

CREATE POLICY "journal_images_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'journal-images');

CREATE POLICY "journal_images_public_read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'journal-images');

-- 匯入官網現有 3 篇文章（fore-website src/lib/journal-data.ts），post_code 沿用讓舊網址不變
INSERT INTO journal_posts
  (post_code, tag, title_zh, title_en, excerpt_zh, excerpt_en, post_date, content_zh, content_en, image_url, published, sort_order)
VALUES
(
  'JN01', 'work', '關於木節', 'On Knots',
  '過去看見木節，總會皺眉想著「這段材料又浪費了」。',
  'We used to wince at a knot in the wood — "there goes another piece wasted."',
  '2019-01-19',
  jsonb_build_array(
    jsonb_build_object('type', 'paragraph', 'text', '關於木節，通常在備料的時候會不經意地出現，過去看見，總會眉頭一皺想著「這段材料又浪費了」，因為它既沒強度、加工不易、更別提會造成變形了。'),
    jsonb_build_object('type', 'paragraph', 'text', '但後來慢慢想，木節其實代表木材作為有機體的生命軌跡——每一塊帶有木節的材料，都承載著樹木的生長歷史：經歷過的季節變化、運輸過程，以及生長的年限。這樣的認知轉變，讓我們對手中的材料多了一份尊重。'),
    jsonb_build_object('type', 'paragraph', 'text', '當然，在家具製作中使用木節仍需謹慎挑選，並非所有木節都適合利用，表面處理也同樣重要。最終，還是需要找到能欣賞這類設計的客戶。')
  ),
  jsonb_build_array(
    jsonb_build_object('type', 'paragraph', 'text', 'Knots tend to show up unannounced while preparing wood. The old reaction was to wince — "there goes another piece wasted" — because a knot has less strength, is harder to work, and can warp the piece.'),
    jsonb_build_object('type', 'paragraph', 'text', 'But over time we came to see it differently: a knot is really the record of a tree''s life as a living thing. Every piece of wood that carries one holds the tree''s growing history — the seasons it lived through, how it was transported, how long it grew. That shift in perspective gave us a new respect for the material in our hands.'),
    jsonb_build_object('type', 'paragraph', 'text', 'That said, using knots in furniture still calls for careful selection — not every knot works, and surface finishing matters just as much. In the end, it also takes a client who can appreciate this kind of design.')
  ),
  'https://images.squarespace-cdn.com/content/v1/59828a60e6f2e1930e97544f/441f27cb-ac7a-4afa-a951-ed5f79af5670/IMG_2675.jpg',
  true, 1
),
(
  'JN02', 'studio', '你的椅子、東川町、寫真甲子園', 'Your Chair, Higashikawa, and the Photography Koshien',
  '每位新生兒都會獲得一張客製化的椅子，刻著名字與出生日期。',
  'Every newborn in this town receives a custom chair, carved with their name and birth date.',
  '2019-08-11',
  jsonb_build_array(
    jsonb_build_object('type', 'paragraph', 'text', '北海道東川町有幾個讓人印象深刻的計畫。「你的椅子」是一個地方創生項目：每位新生兒都會獲得一張客製化的椅子，上面刻有名字和出生日期，承載著孩子誕生的喜悅、希望與激動，成為陪伴孩子成長、具有特殊紀念意義的物品。'),
    jsonb_build_object('type', 'paragraph', 'text', '東川文化藝術交流中心展示歷年來的椅子收藏，也舉辦包浩斯設計展覽——就像是台灣的升級版里民活動中心，配有圖書館、餐廳、語言學校與藝術展場。'),
    jsonb_build_object('type', 'paragraph', 'text', '「寫真甲子園」是自 1994 年開始的高中攝影競賽，每年選出 18 所高中派隊參賽。透過高中生的相機，欣賞他們所記錄的影像，也能感受到地方振興地方價值的精神。如果有機會，很推薦來這裡走走。')
  ),
  jsonb_build_array(
    jsonb_build_object('type', 'paragraph', 'text', 'A few projects in Higashikawa, Hokkaido left a real impression on us. "Your Chair" is a local revitalization initiative: every newborn in the town receives a custom-made chair carved with their name and birth date — carrying the joy, hope, and excitement of a child''s arrival, and becoming a keepsake that grows up alongside them.'),
    jsonb_build_object('type', 'paragraph', 'text', 'The Higashikawa Cultural Arts Exchange Center displays the town''s accumulated chair collection and hosts Bauhaus design exhibitions — something like an upgraded version of a Taiwanese community center, complete with a library, restaurant, language school, and gallery space.'),
    jsonb_build_object('type', 'paragraph', 'text', 'The "Photography Koshien" is a high-school photography competition running since 1994, with 18 schools sending teams each year. Seeing the town through the lens of high-school students is its own kind of pleasure, and you can feel the spirit of a place investing in its own local value. Worth a visit if you ever get the chance.')
  ),
  'https://images.squarespace-cdn.com/content/v1/59828a60e6f2e1930e97544f/1571979596537-12SI63Z2JRG4BCGZME1A/IMG_8720_1.jpg',
  true, 2
),
(
  'JN03', 'customer', 'Charles''s house', 'Charles''s House',
  '與 Charles 及其伴侶相遇於去年的木質生活展，他們很清楚自己未來眼中即將實現的「風景」。',
  'We met Charles and his partner at last year''s wood living exhibition — they already knew the "view" they wanted their future home to become.',
  '2026-06-13',
  jsonb_build_array(
    jsonb_build_object('type', 'paragraph', 'text', '做為一位家具的設計製作者，能夠看到自己的物件被「好好使用」，找到最終的歸屬，心中得到的回饋，如同蓋房子的地基一般，穩穩扎實地填滿心中的一塊小角落，甚至期待有新的生命、新的故事從中萌芽而出。相比於家具製作完成的片刻成就，那是截然不同的感受。'),
    jsonb_build_object('type', 'paragraph', 'text', '與 Charles 及其伴侶相遇於去年的木質生活展，在形形色色的客人當中，他們很清楚自己未來眼中即將實現的「風景」，而這未來生活的樣貌，恰巧與 FØRE 的設計概念有了交集，我們很榮幸成為風景中的一角，將自己製作的物件雙手交給 Charles，也謝謝他們跟我們分享這麼多生活細節，讓我們知道自己的孩子被愛惜使用著，感到無比的欣慰。'),
    jsonb_build_object('type', 'paragraph', 'text', '照片提供：Charles')
  ),
  jsonb_build_array(
    jsonb_build_object('type', 'paragraph', 'text', 'As someone who designs and makes furniture, seeing a piece you''ve made truly "lived with," finding where it belongs — that feeling settles into a quiet corner of you, the way a foundation settles into the ground, and even makes you look forward to whatever new life and stories might grow out of it. It''s a completely different feeling from the moment a piece is finished in the workshop.'),
    jsonb_build_object('type', 'paragraph', 'text', 'We met Charles and his partner last year at a wood living exhibition. Among all kinds of visitors that day, they already had a clear picture of the "view" their future life would become — and that vision happened to overlap with FØRE''s own design thinking. We felt honored to become a small part of that view, handing the piece we made into Charles''s hands. Thank you both for sharing so much of your life with us — knowing our work is being cared for and lived with means a great deal to us.'),
    jsonb_build_object('type', 'paragraph', 'text', 'Photos courtesy of Charles')
  ),
  'https://images.squarespace-cdn.com/content/v1/59828a60e6f2e1930e97544f/1781349037518-4FQ8UBNKI67BB5IOWKVV/S__15564805.jpg',
  true, 3
)
ON CONFLICT (post_code) DO NOTHING;
